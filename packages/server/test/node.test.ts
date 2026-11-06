import { Cause, Effect, Exit, Fiber, Layer, Stream } from 'effect';
import { HttpRouter, HttpServer, HttpServerResponse } from 'effect/http';
import { RpcSerialization } from 'effect/rpc';
import { NodeHttpServer } from '@effect/platform-node';
import { causeToClientError } from '@effect-trpc/core';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { layerHttp } from '../src/index.js';
import { runServer } from '../src/node.js';
import type { RunningServer } from '../src/node.js';
import {
  appRouter,
  createdAt,
  getCause,
  makeServer,
  NotFound,
  Unauthorized,
  User,
} from './fixtures.js';
import type { Probe } from './fixtures.js';
import { withHttpClient } from './http-client.js';

let server: RunningServer;
let probe: Probe;

beforeEach(async () => {
  const made = makeServer();
  probe = made.probe;
  server = await runServer(appRouter, { handlers: made.layer, port: 0 });
});

afterEach(async () => {
  await server.dispose();
});

describe('runServer (node standalone adapter)', () => {
  it('listens on an ephemeral port and reports an absolute url', () => {
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toBe(`http://localhost:${server.port}/rpc`);
  });

  it('delivers Schema.Class instances with methods and Dates', async () => {
    const exit = await withHttpClient(server.url, (client) => client['user.byId']({ id: 'ada' }));
    const user = Exit.isSuccess(exit) ? exit.value : undefined;
    expect(user).toBeInstanceOf(User);
    expect(user?.greet()).toBe('Hello, Ada!');
    expect(user?.createdAt).toBeInstanceOf(Date);
    expect(user?.createdAt.getTime()).toBe(createdAt.getTime());
  });

  it('delivers typed errors as TaggedError instances', async () => {
    const exit = await withHttpClient(server.url, (client) => client['user.byId']({ id: 'ghost' }));
    const error = causeToClientError(getCause(exit));
    expect(error).toBeInstanceOf(NotFound);
    expect(error).toMatchObject({ id: 'ghost' });
  });

  it('delivers defects as Die and keeps the connection usable', async () => {
    const exit = await withHttpClient(server.url, (client) =>
      Effect.gen(function* () {
        const died = yield* Effect.exit(client['debug.die']());
        const ok = yield* client.health();
        return { died, ok };
      }),
    );
    const value = Exit.isSuccess(exit) ? exit.value : undefined;
    expect(value?.ok).toBe('ok');
    expect(value !== undefined && Exit.hasDies(value.died)).toBe(true);
  });

  it('streams subscriptions', async () => {
    const exit = await withHttpClient(server.url, (client) =>
      Stream.runCollect(client['user.list']({ count: 3 })),
    );
    const users = Exit.isSuccess(exit) ? exit.value : [];
    expect(users.map((u) => u.id)).toEqual(['u1', 'u2', 'u3']);
    expect(users[2]).toBeInstanceOf(User);
  });

  it('supports middleware with headers over HTTP', async () => {
    const exit = await withHttpClient(server.url, (client) =>
      Effect.gen(function* () {
        const me = yield* client['user.me'](undefined, { headers: { 'x-user': 'ada' } });
        const denied = yield* Effect.flip(client['user.me']());
        return { me, denied };
      }),
    );
    const value = Exit.isSuccess(exit) ? exit.value : undefined;
    expect(value?.me.name).toBe('ada');
    expect(value?.denied).toBeInstanceOf(Unauthorized);
  });

  it('client-side interruption interrupts the handler', async () => {
    await withHttpClient(server.url, (client) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(client['debug.hang']());
        yield* Effect.sleep('50 millis');
        yield* Fiber.interrupt(fiber);
      }),
    );
    await expect(probe.hangInterrupted).resolves.toBeUndefined();
  });

  it('closes the server on dispose', async () => {
    const response = await fetch(server.url, { method: 'POST', body: '' });
    await response.body?.cancel();
    await server.dispose();
    await probe.released;
    await expect(fetch(server.url, { method: 'POST', body: '' })).rejects.toThrow('fetch failed');
  });
});

describe('runServer shutdown', () => {
  it('dispose() completes with a request in flight and interrupts its handler', async () => {
    const { layer, probe: hangProbe } = makeServer();
    const slow = await runServer(appRouter, {
      handlers: layer,
      port: 0,
      gracefulShutdownTimeout: '50 millis',
    });
    const pending = fetch(slow.url, {
      method: 'POST',
      headers: { 'content-type': 'application/ndjson' },
      body: `${JSON.stringify({ _tag: 'Request', id: '1', tag: 'debug.hang', payload: null, headers: [] })}\n`,
    }).then(
      (response) => response.status,
      () => 'closed',
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await slow.dispose();
    await expect(hangProbe.hangInterrupted).resolves.toBeUndefined();
    expect([200, 503, 'closed']).toContain(await pending);
  });
});

describe('layerHttp', () => {
  it('composes into an existing Effect HTTP app with NodeHttpServer.layerTest', async () => {
    const { layer } = makeServer();
    const app = HttpRouter.serve(
      Layer.mergeAll(
        layerHttp(appRouter, { handlers: layer, path: '/api/rpc' }),
        HttpRouter.add('GET', '/health', Effect.succeed(HttpServerResponse.text('up'))),
      ),
      { disableLogger: true, disableListenLog: true },
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const address = HttpServer.formatAddress((yield* HttpServer.HttpServer).address);
        const exit = yield* Effect.promise(() =>
          withHttpClient(`${address}/api/rpc`, (client) => client['user.byId']({ id: 'ada' })),
        );
        const health = yield* Effect.promise(() =>
          fetch(`${address}/health`).then((r) => r.text()),
        );
        return { exit, health };
      }).pipe(Effect.provide(app.pipe(Layer.provideMerge(NodeHttpServer.layerTest)))),
    );
    expect(result.health).toBe('up');
    expect(Exit.isSuccess(result.exit) ? result.exit.value : undefined).toBeInstanceOf(User);
  });

  it('serves serialization: "json" to json clients', async () => {
    const { layer } = makeServer();
    const json = await runServer(appRouter, { handlers: layer, port: 0, serialization: 'json' });
    try {
      const exit = await withHttpClient(
        json.url,
        (client) => client['user.byId']({ id: 'ada' }),
        RpcSerialization.layerJson,
      );
      expect(Exit.isSuccess(exit) ? exit.value : Cause.pretty(getCause(exit))).toBeInstanceOf(User);
    } finally {
      await json.dispose();
    }
  });
});
