import { appRouter } from '@effect-trpc-examples/shared';
import { createStartHandler } from '@effect-trpc/start';
import { createFileRoute } from '@tanstack/react-router';

import { ServerLive } from '../../rpc/server';

const handler = createStartHandler(appRouter, { handlers: ServerLive });

export const Route = createFileRoute('/api/rpc/$')({
  // GET answers 405 with `Allow: POST`: a clear answer for someone opening the URL.
  server: { handlers: { POST: handler, GET: handler } },
});
