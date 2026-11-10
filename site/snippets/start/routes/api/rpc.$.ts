// src/routes/api/rpc.$.ts
import { createFileRoute } from '@tanstack/react-router';
import { createStartHandler } from '@rpc-effect/start';

import { appRouter } from '@/router';
import { ServerLive } from '@/server';

const handler = createStartHandler(appRouter, { handlers: ServerLive /* path: '/api/rpc' */ });

export const Route = createFileRoute('/api/rpc/$')({
  // GET answers 405 with `Allow: POST`: a clear answer for someone opening the URL.
  server: { handlers: { POST: handler, GET: handler } },
});
