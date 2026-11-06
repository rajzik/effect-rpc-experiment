import { Effect, Stream } from 'effect';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import {
  createClient,
  httpLink,
  RpcDefect,
  RpcTransportError,
  wsLink,
  type Client,
} from '../src/index.js';
import { alice, appRouter, Forbidden, NotFound, User, type AppRouter } from './fixtures.js';
import { drain, rejectionOf } from './helpers.js';
import { startServer, type TestServer } from './servers.js';

describe.each(['ndjson', 'json'] as const)('httpLink over a Node HTTP server (%s)', (format) => {
  let server: TestServer;
  let client: Client<AppRouter>;

  beforeAll(async () => {
    server = await startServer({ protocol: 'http', serialization: format });
    client = createClient(appRouter, {
      link: httpLink({ url: server.url, serialization: format }),
    });
  });

  afterAll(async () => {
    await client.dispose();
    await server.dispose();
  });

  it('decodes Schema.Class instances with methods and Date fields', async () => {
    const user = await client.user.byId({ id: '1' });
    expect(user).toBeInstanceOf(User);
    expect(user.greet()).toBe('Hello, Alice!');
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.createdAt.toISOString()).toBe(alice().createdAt.toISOString());
  });

  it('rejects with TaggedError instances', async () => {
    const notFound = await rejectionOf(client.user.byId({ id: '42' }));
    expect(notFound).toBeInstanceOf(NotFound);
    expect(notFound).toMatchObject({ id: '42' });
    expect(await rejectionOf(client.user.byId({ id: 'secret' }))).toBeInstanceOf(Forbidden);
  });

  it('turns a handler defect into RpcDefect and serves the next call', async () => {
    const defect = await rejectionOf(client.boom());
    expect(defect).toBeInstanceOf(RpcDefect);
    expect(defect).toMatchObject({ message: 'kaboom' });
    await expect(client.user.create({ name: 'Zoe' })).resolves.toBeInstanceOf(User);
  });

  it('streams subscription elements in order', async () => {
    const { values, error } = await drain(client.ticks({ n: 25 }));
    expect(error).toBeUndefined();
    expect(values).toEqual(Array.from({ length: 25 }, (_, i) => i));
  });

  it('throws the typed error instance from a stream failing mid-way', async () => {
    const { values, error } = await drain(client.tickStream({ failAt: 3 }));
    expect(values).toEqual([0, 1, 2]);
    expect(error).toBeInstanceOf(NotFound);
  });

  it('serves the Effect client with typed errors', async () => {
    const result = await Effect.runPromise(
      client.$effect.user.byId({ id: 'nope' }).pipe(
        Effect.map((user) => user.name),
        Effect.catchTags({
          NotFound: (e) => Effect.succeed(`not found: ${e.id}`),
          Forbidden: () => Effect.succeed('forbidden'),
        }),
      ),
    );
    expect(result).toBe('not found: nope');
    const ticks = await Effect.runPromise(Stream.runCollect(client.$effect.ticks({ n: 2 })));
    expect(ticks).toEqual([0, 1]);
  });
});

describe('httpLink options', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startServer({ protocol: 'http' });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('uses the custom fetch option', async () => {
    const fetchSpy = vi.fn<typeof fetch>((input, init) => fetch(input, init));
    const client = createClient(appRouter, {
      link: httpLink({ url: server.url, fetch: fetchSpy }),
    });
    await expect(client.health()).resolves.toBe('ok');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const input = fetchSpy.mock.calls[0]?.[0];
    expect(input instanceof Request ? input.url : input?.toString()).toContain(server.url);
    await client.dispose();
  });

  it('sends static and per-request link headers as HTTP headers', async () => {
    let n = 0;
    const client = createClient(appRouter, {
      link: httpLink({ url: new URL(server.url), headers: () => ({ 'x-request': String(++n) }) }),
      headers: { 'x-user': 'rpc' },
    });
    await expect(client.headers()).resolves.toEqual({ 'x-request': '1', 'x-user': 'rpc' });
    await expect(client.whoami()).resolves.toBe('rpc');
    await expect(client.headers()).resolves.toMatchObject({ 'x-request': '3' });
    await client.dispose();
  });

  it('maps non-2xx responses and network failures to RpcTransportError', async () => {
    const failing = createClient(appRouter, {
      link: httpLink({
        url: server.url,
        fetch: () => Promise.resolve(new Response('upstream down', { status: 502 })),
      }),
    });
    const statusError = await rejectionOf(failing.health());
    expect(statusError).toBeInstanceOf(RpcTransportError);
    await failing.dispose();

    const unreachable = createClient(appRouter, {
      link: httpLink({ url: 'http://127.0.0.1:9/rpc' }),
    });
    expect(await rejectionOf(unreachable.health())).toBeInstanceOf(RpcTransportError);
    const fxError = await Effect.runPromise(Effect.flip(unreachable.$effect.health()));
    expect(fxError).toBeInstanceOf(RpcTransportError);
    await unreachable.dispose();
  });

  it('requires an absolute http(s) URL', () => {
    expect(() => httpLink({ url: '/rpc' })).toThrow(/httpLink: url must be an absolute URL/);
    expect(() => httpLink({ url: 'ws://localhost/rpc' })).toThrow(/http: or https:/);
    expect(() => wsLink({ url: 'http://localhost/rpc' })).toThrow(/ws: or wss:/);
  });
});
