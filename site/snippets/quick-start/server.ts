// server.ts — serve the router over HTTP on Node.
import { Layer } from 'effect';
import { NodeRuntime } from '@effect/platform-node';
import { serve } from '@rpc-effect/server/node';

import { appRouter } from '@/router';
import { ServerLive } from '@/server';

// POST http://localhost:3000/rpc — one request per call, NDJSON responses.
Layer.launch(serve(appRouter, { handlers: ServerLive, port: 3000 })).pipe(NodeRuntime.runMain);
