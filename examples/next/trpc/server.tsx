// oxlint-disable-next-line import/no-unassigned-import -- Next's marker: bundling this into client code fails the build
import 'server-only';
import { appRouter } from '@effect-trpc-examples/shared';
import { createRscHelpers } from '@effect-trpc/next';
import { headers } from 'next/headers';

import { ServerLive } from '@/server';

import { HydrationBoundary } from './client';

export const { getQueryClient, rpc, prefetch, HydrateClient, caller } = createRscHelpers(
  appRouter,
  // In-process: no HTTP hop. The request's cookies reach the `Auth` middleware.
  { handlers: ServerLive, headers: async () => await headers() },
  { HydrationBoundary },
);
