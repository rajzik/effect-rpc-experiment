// Ports of tRPC tests/server/smoke.test.ts and
// tests/server/regression/issue-2540-undefined-mutation.test.ts: the basic query / mutation /
// subscription round trip through every entry point, including procedures without input.
import { Effect, Stream } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { createCaller, toWebHandler } from '../src/index.js';
import type { Caller, WebHandler } from '../src/index.js';
import { runServer } from '../src/node.js';
import type { RunningServer } from '../src/node.js';
import { appRouter, getSuccess, makeServer, User } from './fixtures.js';
import type { AppRouter } from './fixtures.js';
import { withHttpClient } from './http-client.js';
import { call, exitFrame } from './wire.js';

let server: RunningServer;
let web: WebHandler;
let caller: Caller<AppRouter>;

beforeAll(async () => {
  server = await runServer(appRouter, { handlers: makeServer().layer, port: 0 });
  web = await toWebHandler(appRouter, { handlers: makeServer().layer });
  caller = createCaller(appRouter, { handlers: makeServer().layer });
});

afterAll(async () => {
  await Promise.all([server.dispose(), web.dispose(), caller.dispose()]);
});

describe('smoke', () => {
  it('query, mutation and subscription over HTTP', async () => {
    const exit = await withHttpClient(server.url, (client) =>
      Effect.all({
        health: client.health(),
        created: client['user.create']({ name: 'Linus' }),
        listed: Stream.runCollect(client['user.list']({ count: 2 })),
      }),
    );
    const { health, created, listed } = getSuccess(exit);
    expect(health).toBe('ok');
    expect(created).toBeInstanceOf(User);
    expect(created.greet()).toBe('Hello, Linus!');
    expect(listed).toHaveLength(2);
  });

  it('the same calls in-process', async () => {
    expect(await caller.$promise.health()).toBe('ok');
    expect((await caller.$promise.user.create({ name: 'Linus' })).id).toBe('linus');
    const ids: Array<string> = [];
    for await (const user of caller.$promise.user.list({ count: 2 })) ids.push(user.id);
    expect(ids).toEqual(['u1', 'u2']);
  });
});

describe('issue-2540: mutations without input', () => {
  it('works over HTTP with no argument', async () => {
    const exit = await withHttpClient(server.url, (client) => client['debug.ping']());
    expect(getSuccess(exit)).toBe('pong');
  });

  it('works in-process with no argument and with undefined', async () => {
    expect(await caller.$promise.debug.ping()).toBe('pong');
    expect(await caller.$promise.debug.ping(undefined)).toBe('pong');
    expect(await Effect.runPromise(caller.debug.ping())).toBe('pong');
  });

  it('accepts a null payload on the wire (how void is encoded)', async () => {
    expect(exitFrame(await call(web, { tag: 'debug.ping', payload: null }))).toEqual({
      _tag: 'Success',
      value: 'pong',
    });
  });
});
