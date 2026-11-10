'use client';
import { appRouter } from '@rpc-effect-examples/shared';
import { createNextRpcClient } from '@rpc-effect/next';

export const { RpcProvider, useRpc, useRpcClient, HydrationBoundary } = createNextRpcClient(
  appRouter,
  { url: '/api/rpc' },
);
