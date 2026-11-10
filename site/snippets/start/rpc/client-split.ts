// src/rpc/client.ts — keeping the server half out of the browser bundle
import { createIsomorphicFn } from '@tanstack/react-start';
import { createBrowserClient, createServerClient } from '@rpc-effect/start';

import { appRouter } from '@/router';
import { ServerLive } from '@/server';

// Start's compiler removes the `.server()` branch (and its imports) from the client build.
const makeClient = createIsomorphicFn()
  .server(() => createServerClient(appRouter, { handlers: ServerLive }))
  .client(() => createBrowserClient(appRouter, { url: '/api/rpc' }));

export const client = makeClient();
