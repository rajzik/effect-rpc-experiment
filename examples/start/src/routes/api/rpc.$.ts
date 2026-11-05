import { createStartHandler } from '@effect-trpc/start';
import { createFileRoute } from '@tanstack/react-router';

import { appRouter, ServerLive } from '../../rpc/router';

const handler = createStartHandler(appRouter, { handlers: ServerLive });

export const Route = createFileRoute('/api/rpc/$')({
  server: { handlers: { POST: handler, GET: handler } },
});
