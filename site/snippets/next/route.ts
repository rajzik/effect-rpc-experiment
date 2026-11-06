// app/api/rpc/[[...rpc]]/route.ts
import { createRouteHandler } from '@effect-trpc/next';

import { appRouter } from '@/router';
import { ServerLive } from '@/server';

export const { GET, POST } = createRouteHandler(appRouter, {
  handlers: ServerLive,
  // path: '/api/rpc' (default), basePath: next.config's basePath, serialization: 'ndjson'
});
