import { createServer } from 'node:http';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { NodeHttpServer } from '@effect/platform-node';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { createClient, wsLink, type Client } from '@rpc-effect/client';
import { layerHttp } from '@rpc-effect/server';
import { appRouter, HandlersLive, NotFound, User, type AppRouter } from './fixtures.js';

// Regression: `wsLink` and `layerHttp(..., { protocol: 'websocket' })` must agree on the wire
// format when neither side sets `serialization`.
describe('websocket with default serialization on both sides', () => {
  let runtime: ManagedRuntime.ManagedRuntime<HttpServer.HttpServer, unknown>;
  let client: Client<AppRouter>;

  beforeAll(async () => {
    const app = layerHttp(appRouter, { handlers: HandlersLive, protocol: 'websocket' });
    runtime = ManagedRuntime.make(
      HttpRouter.serve(app, { disableLogger: true, disableListenLog: true }).pipe(
        Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: 0 })),
      ),
    );
    const address = await runtime.runPromise(Effect.map(HttpServer.HttpServer, (s) => s.address));
    if (address._tag === 'UnixPathAddress') throw new Error('expected a TCP address');
    client = createClient(appRouter, {
      link: wsLink({ url: `ws://localhost:${address.port}/rpc` }),
    });
  });

  afterAll(async () => {
    await client?.dispose();
    await runtime?.dispose();
  });

  it('round-trips Schema.Class values and typed errors', async () => {
    const user = await client.user.byId({ id: '1' });
    expect(user).toBeInstanceOf(User);
    await expect(client.user.byId({ id: 'ghost' })).rejects.toBeInstanceOf(NotFound);
  });
});
