import { appRouter } from '@rpc-effect-examples/shared';
import { createRouteHandler } from '@rpc-effect/next';

import { ServerLive } from '@/server';

export const { GET, POST } = createRouteHandler(appRouter, { handlers: ServerLive });
