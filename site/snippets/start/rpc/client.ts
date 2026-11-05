// src/rpc/client.ts
import { createIsomorphicClient, createStartHelpers } from '@effect-trpc/start';

import { appRouter } from '@/router';
import { ServerLive } from '@/server';

export const client = createIsomorphicClient(appRouter, {
  server: { handlers: ServerLive }, // on the server: in-process, no HTTP, no serialization
  client: { url: '/api/rpc' }, // in the browser: httpLink
  // isServer defaults to `typeof window === 'undefined'`
});

export const { rpc, RpcProvider, useRpc, useRpcClient, hydration } = createStartHelpers(appRouter, {
  client,
});
