import { appRouter } from '@effect-trpc-examples/shared';
import { createRouteHandler } from '@effect-trpc/next';

import { ServerLive } from '@/server';

export const { GET, POST } = createRouteHandler(appRouter, { handlers: ServerLive });
