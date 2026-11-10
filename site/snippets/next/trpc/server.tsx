// trpc/server.tsx — import 'server-only' at the top in your app.
import { createRscHelpers } from '@rpc-effect/next';
import { headers } from 'next/headers';

import { appRouter } from '@/router';
import { ServerLive } from '@/server';

import { HydrationBoundary } from './client';

export const { getQueryClient, rpc, prefetch, HydrateClient, caller } = createRscHelpers(
  appRouter,
  // In-process: no HTTP hop. Forward the request's headers to middleware.
  { handlers: ServerLive, headers: async () => await headers() },
  // The boundary must come from a 'use client' module.
  { HydrationBoundary },
);
