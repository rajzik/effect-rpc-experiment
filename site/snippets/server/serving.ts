import { createServer } from 'node:http';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { layerHttp, toWebHandler } from '@rpc-effect/server';
import { runServer, serve } from '@rpc-effect/server/node';

import { appRouter } from '@/router';
import { ServerLive } from '@/server';

// #region web
// Any fetch runtime: Next.js, TanStack Start, Bun, Deno, Cloudflare Workers, Hono, …
const { handler, dispose } = await toWebHandler(appRouter, {
  handlers: ServerLive,
  path: '/api/rpc', // must equal the pathname the platform routes here
});

// Bun.serve({ fetch: handler });
// export default { fetch: handler }; // Workers
// app.post('/api/rpc', (c) => handler(c.req.raw)); // Hono

await dispose(); // interrupts in-flight requests; later requests answer 503
// #endregion web

// #region node
// A long-running process: a Layer.
const ServerProcess = serve(appRouter, { handlers: ServerLive, port: 3000 });
// Layer.launch(ServerProcess).pipe(NodeRuntime.runMain);

// Tests and scripts: a Promise. Port 0 picks a free port.
const server = await runServer(appRouter, { handlers: ServerLive, port: 0 });
server.url; // "http://localhost:54321/rpc"
await server.dispose();
// #endregion node

// #region layer
// One route of a larger Effect HTTP app.
const RpcRoute = layerHttp(appRouter, { handlers: ServerLive, path: '/api/rpc' });
const HealthRoute = HttpRouter.add('GET', '/health', Effect.succeed(HttpServerResponse.text('up')));

const App = HttpRouter.serve(Layer.mergeAll(RpcRoute, HealthRoute)).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
);
// Layer.launch(App).pipe(NodeRuntime.runMain);
// #endregion layer

// #region websocket
// A WebSocket endpoint for `wsLink`: every call and subscription over one connection.
const WsRoute = layerHttp(appRouter, { handlers: ServerLive, path: '/ws', protocol: 'websocket' });
const WsApp = HttpRouter.serve(Layer.mergeAll(RpcRoute, WsRoute)).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
);
// #endregion websocket

void [ServerProcess, App, WsApp, NodeRuntime];
