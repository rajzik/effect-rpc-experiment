import { createClient, httpLink, localLink, wsLink } from '@rpc-effect/client';
import { toWebHandler } from '@rpc-effect/server';

import { appRouter } from '@/router';
import { ServerLive } from '@/server';

// #region http
// One POST per call. Subscriptions stream as NDJSON over the same request.
const overHttp = createClient(appRouter, {
  link: httpLink({
    url: 'https://api.example.com/rpc',
    headers: { 'x-app-version': '1.4.0' },
  }),
});
// #endregion http

// #region ws
// One multiplexed WebSocket for every call and subscription. Opened on first use.
// The server needs `layerHttp(router, { protocol: 'websocket' })` at that path.
const overWs = createClient(appRouter, {
  link: wsLink({ url: 'wss://api.example.com/ws', retryTransientErrors: true }),
});
// #endregion ws

// #region local
// In-process: no network, no serialization. Middleware still runs and headers still reach it.
// The type checks that the layer implements every procedure and middleware.
const inProcess = createClient(appRouter, { link: localLink({ handlers: ServerLive }) });
// #endregion local

// #region fetch
// Serve and call through a fetch handler, with no port (tests, edge functions calling themselves).
const { handler } = await toWebHandler(appRouter, { handlers: ServerLive });
const viaHandler = createClient(appRouter, {
  link: httpLink({
    url: 'http://in-memory/rpc', // any absolute URL whose path matches the handler's path
    fetch: (input, init) => handler(new Request(input, init)),
  }),
});
// #endregion fetch

void [overHttp, overWs, inProcess, viaHandler];
