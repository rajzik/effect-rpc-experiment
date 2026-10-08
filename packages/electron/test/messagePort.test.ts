import { MessageChannel } from 'node:worker_threads';
import { Effect, Exit, Scope } from 'effect';
import { RpcSerialization } from 'effect/rpc';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { createClient, RpcDefect, RpcTransportError } from '@effect-trpc/client';
import {
  messagePortLink,
  MessagePortServer,
  type MessagePortServer as Server,
} from '../src/index.js';
import { FakePortMain, tick } from './fakes.js';
import { appRouter, makeHandlers, NotFound, User } from './fixtures.js';
import { drain, rejectionOf, within } from './helpers.js';

/** Runs `MessagePortServer.serve` in a scope that the test closes afterwards. */
const startServer = async () => {
  const scope = Effect.runSync(Scope.make());
  const { handlers, probe } = makeHandlers();
  const server: Server = await Effect.runPromise(
    MessagePortServer.serve(appRouter, { handlers }).pipe(Scope.provide(scope)),
  );
  const attach = (port: Parameters<Server['attach']>[0], headers?: Record<string, string>) =>
    Effect.runPromise(server.attach(port, { headers }));
  const close = () => Effect.runPromise(Scope.close(scope, Exit.void));
  return { server, attach, probe, close };
};

let cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const f of cleanup.reverse()) await f();
  cleanup = [];
});

describe('messagePortLink ⇄ MessagePortServer (no Electron)', () => {
  it('serves a client over a plain Node MessageChannel', async () => {
    const { attach, close } = await startServer();
    cleanup.push(close);
    const { port1, port2 } = new MessageChannel();
    expect(await attach(port2)).toBe(0);
    const client = createClient(appRouter, { link: messagePortLink(port1) });
    cleanup.push(() => client.dispose());
    const user = await client.user.byId({ id: '1' });
    expect(user).toBeInstanceOf(User);
    expect(await rejectionOf(client.user.byId({ id: 'ghost' }))).toBeInstanceOf(NotFound);
    expect((await drain(client.ticks({ n: 3 }))).values).toEqual([0, 1, 2]);
    expect(await rejectionOf(client.boom())).toBeInstanceOf(RpcDefect);
    await expect(client.whoami()).resolves.toBeNull();
  });

  it('accepts EventEmitter-style ports (MessagePortMain) and trusted headers', async () => {
    const { attach, close } = await startServer();
    cleanup.push(close);
    const { port1, port2 } = new MessageChannel();
    await attach(new FakePortMain(port2), { 'X-Effect-Trpc-Sender-Id': '5' });
    const client = createClient(appRouter, { link: messagePortLink(port1) });
    cleanup.push(() => client.dispose());
    await expect(client.whoami()).resolves.toBe(5);
  });

  it('a link built from a port factory opens one port per client; a bare port is single-use', async () => {
    const { attach, close } = await startServer();
    cleanup.push(close);
    let opened = 0;
    const link = messagePortLink(async () => {
      const { port1, port2 } = new MessageChannel();
      await attach(port2);
      opened++;
      return port1;
    });
    const a = createClient(appRouter, { link });
    const b = createClient(appRouter, { link });
    cleanup.push(
      () => a.dispose(),
      () => b.dispose(),
    );
    await expect(Promise.all([a.whoami(), b.whoami()])).resolves.toEqual([null, null]);
    expect(opened).toBe(2);

    const { port1, port2 } = new MessageChannel();
    await attach(port2);
    const single = messagePortLink(port1);
    const first = createClient(appRouter, { link: single });
    const second = createClient(appRouter, { link: single });
    cleanup.push(
      () => first.dispose(),
      () => second.dispose(),
    );
    await expect(first.whoami()).resolves.toBeNull();
    const error = await rejectionOf(second.whoami());
    expect(error).toBeInstanceOf(RpcDefect);
    expect((error as RpcDefect).message).toContain('already used');
  });

  it('answers malformed frames with a defect and keeps serving other clients', async () => {
    const { attach, close } = await startServer();
    cleanup.push(close);
    const raw = new MessageChannel();
    await attach(raw.port2);
    const received: Array<unknown> = [];
    raw.port1.on('message', (data: unknown) => received.push(data));
    raw.port1.postMessage('not json');
    raw.port1.postMessage('null');
    raw.port1.postMessage(42);
    await tick(30);
    // the first frame is the server's connection acknowledgement
    const [ready, ...defects] = received;
    expect(ready).toBe('"@effect-trpc/electron/ready"');
    expect(defects).toHaveLength(3);
    for (const frame of defects) {
      expect(JSON.parse(String(frame))).toMatchObject({ _tag: 'Defect' });
    }
    raw.port1.close();

    const { port1, port2 } = new MessageChannel();
    await attach(port2);
    const client = createClient(appRouter, { link: messagePortLink(port1) });
    cleanup.push(() => client.dispose());
    await expect(client.user.create({ name: 'ok' })).resolves.toBeInstanceOf(User);
  });

  it('answers hostile messages without dropping the connection or affecting others', async () => {
    const { attach, close } = await startServer();
    cleanup.push(close);
    const { port1, port2 } = new MessageChannel();
    await attach(port2);
    const client = createClient(appRouter, { link: messagePortLink(port1) });
    cleanup.push(() => client.dispose());
    await expect(client.whoami()).resolves.toBeNull();

    const raw = new MessageChannel();
    await attach(raw.port2);
    const request = { _tag: 'Request', tag: 'whoami', payload: null };
    const hostile: ReadonlyArray<unknown> = [
      { ...request, id: 1, headers: 42 },
      { ...request, id: 2, headers: null },
      { ...request, id: 3, headers: [[1, 2], 'x', null] },
      { ...request, id: { nested: true }, headers: [] },
      { ...request, id: 4, headers: [], traceId: 5, spanId: {}, sampled: 'yes' },
      { _tag: 'Interrupt', requestId: { bad: true } },
      { _tag: 'Ack', requestId: null },
      { _tag: 'Ping' },
      { _tag: 'Eof' },
      { _tag: 'Unknown' },
    ];
    const received: Array<string> = [];
    raw.port1.on('message', (data: string) => received.push(data));
    for (const message of hostile) raw.port1.postMessage(JSON.stringify(message));
    raw.port1.postMessage(JSON.stringify({ ...request, id: 99, headers: [] }));
    await tick(50);
    // the same connection still answers a valid request
    expect(received).toContain(
      '{"_tag":"Exit","requestId":99,"exit":{"_tag":"Success","value":null}}',
    );
    expect(received).not.toContain('"@effect-trpc/electron/close"');
    raw.port1.close();

    await expect(client.whoami()).resolves.toBeNull();
    expect((await drain(client.ticks({ n: 3 }))).values).toEqual([0, 1, 2]);
  });

  it('supports binary serializations (Uint8Array frames)', async () => {
    const encoder = new TextEncoder();
    const json = RpcSerialization.json;
    const binary = RpcSerialization.RpcSerialization.of({
      ...json,
      makeUnsafe: () => {
        const parser = json.makeUnsafe();
        return {
          decode: (data) => {
            expect(data).toBeInstanceOf(Uint8Array);
            return parser.decode(data);
          },
          encode: (message) => encoder.encode(String(parser.encode(message))),
        };
      },
    });
    const scope = Effect.runSync(Scope.make());
    cleanup.push(() => Effect.runPromise(Scope.close(scope, Exit.void)));
    const server = await Effect.runPromise(
      MessagePortServer.serve(appRouter, {
        handlers: makeHandlers().handlers,
        serialization: binary,
      }).pipe(Scope.provide(scope)),
    );
    const { port1, port2 } = new MessageChannel();
    await Effect.runPromise(server.attach(port2));
    const client = createClient(appRouter, {
      link: messagePortLink(port1, { serialization: binary }),
    });
    cleanup.push(() => client.dispose());
    await expect(client.user.byId({ id: '1' })).resolves.toBeInstanceOf(User);
    expect((await drain(client.ticks({ n: 3 }))).values).toEqual([0, 1, 2]);
  });

  it('closing the server scope closes its ports and fails pending calls', async () => {
    const { attach, close, probe } = await startServer();
    const { port1, port2 } = new MessageChannel();
    await attach(port2);
    const client = createClient(appRouter, { link: messagePortLink(port1) });
    cleanup.push(() => client.dispose());
    const pending = rejectionOf(client.slow());
    await within(probe.started);
    await close();
    expect(probe.state.interrupted).toBe(1);
    expect(await within(pending)).toBeInstanceOf(RpcTransportError);
  });
});
