'use client';
import { appRouter } from '@effect-trpc-examples/shared';
import { createNextRpcClient } from '@effect-trpc/next';

export const { RpcProvider, useRpc, useRpcClient, HydrationBoundary } = createNextRpcClient(
  appRouter,
  { url: '/api/rpc' },
);
