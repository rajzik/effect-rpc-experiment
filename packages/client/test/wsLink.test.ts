import { Effect, Stream } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { createClient, RpcDefect, wsLink, type Client } from '../src/index.js';
import { appRouter, Forbidden, NotFound, User, type AppRouter } from './fixtures.js';
import { drain, rejectionOf } from './helpers.js';
import { startServer, type TestServer } from './servers.js';

describe.each(['ndjson', 'json'] as const)('wsLink over a Node WebSocket server (%s)', (format) => {
  let server: TestServer;
  let client: Client<AppRouter>;

  beforeAll(async () => {
    server = await startServer({ protocol: 'websocket', serialization: format });
    client = createClient(appRouter, {
      link: wsLink({ url: server.wsUrl, serialization: format }),
      headers: { 'x-user': 'socket' },
    });
  });

  afterAll(async () => {
    await client.dispose();
    await server.dispose();
  });

  it('performs queries and mutations with class instances', async () => {
    const user = await client.user.byId({ id: '1' });
    expect(user).toBeInstanceOf(User);
    expect(user.greet()).toBe('Hello, Alice!');
    const created = await client.user.create({ name: 'Ws' });
    expect(created.createdAt).toBeInstanceOf(Date);
    await expect(client.user.reset()).resolves.toBe(0);
  });

  it('rejects with typed errors and RpcDefect', async () => {
    expect(await rejectionOf(client.user.byId({ id: 'x' }))).toBeInstanceOf(NotFound);
    expect(await rejectionOf(client.user.byId({ id: 'secret' }))).toBeInstanceOf(Forbidden);
    expect(await rejectionOf(client.boom())).toBeInstanceOf(RpcDefect);
    await expect(client.health()).resolves.toBe('ok');
  });

  it('streams subscriptions and their typed failures', async () => {
    expect((await drain(client.ticks({ n: 5 }))).values).toEqual([0, 1, 2, 3, 4]);
    const failed = await drain(client.tickStream({ failAt: 2 }));
    expect(failed.values).toEqual([0, 1]);
    expect(failed.error).toBeInstanceOf(NotFound);
    const viaEffect = await Effect.runPromise(Stream.runCollect(client.$effect.ticks({ n: 2 })));
    expect(viaEffect).toEqual([0, 1]);
  });

  it('multiplexes concurrent calls and sends rpc headers', async () => {
    const [who, headers, ticks] = await Promise.all([
      client.whoami(),
      client.headers(undefined, { headers: { 'x-call': 'yes' } }),
      drain(client.ticks({ n: 3 })),
    ]);
    expect(who).toBe('socket');
    expect(headers).toEqual({ 'x-user': 'socket', 'x-call': 'yes' });
    expect(ticks.values).toEqual([0, 1, 2]);
  });
});
