// trpc/client.tsx
'use client';
import { createNextRpcClient } from '@effect-trpc/next';

import { appRouter } from '@/router';

export const { RpcProvider, useRpc, useRpcClient, HydrationBoundary } = createNextRpcClient(
  appRouter,
  { url: '/api/rpc' }, // relative: resolved against getBaseUrl(), in the browser and during SSR
);
