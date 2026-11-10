/**
 * Query options shared by the components and by server-side prefetching. This module has no
 * `'use client'` directive and no hooks, so server components, loaders and route modules can import
 * it to prefetch exactly the queries the components read.
 */
import type { RpcOptionsProxy } from '@rpc-effect/tanstack-react-query';

import type { AppRouter } from '../domain';

/**
 * The options of the list's infinite query. Prefetch with the same options to hydrate the list
 * from the server.
 */
export const taskListOptions = (rpc: RpcOptionsProxy<AppRouter>) =>
  rpc.tasks.list.infiniteQueryOptions(
    {},
    { getNextPageParam: (page) => page.nextCursor, initialCursor: null },
  );

/**
 * The options of the detail query. Prefetch with the same options to hydrate the page from the
 * server. A missing task is a typed result, not a transient failure: `retry: false` stops the
 * failing request from being repeated, and `retryOnMount: false` keeps an errored query that
 * arrived in the dehydrated cache as it is (on the server it renders the typed error instead of
 * the loading state, in the browser it is decoded instead of fetched again).
 */
export const taskDetailOptions = (rpc: RpcOptionsProxy<AppRouter>, id: number) =>
  rpc.tasks.byId.queryOptions({ id }, { retry: false, retryOnMount: false });

/** The options of the `session.me` query. Prefetch with them to render the name on the server. */
export const sessionOptions = (rpc: RpcOptionsProxy<AppRouter>) =>
  rpc.session.me.queryOptions(undefined, { retry: false });
