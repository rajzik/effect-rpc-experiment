/**
 * The TanStack `QueryClient` factory for Next.js App Router apps (tRPC's `trpc/query-client.ts`).
 *
 * `createRscHelpers` (server components) and `createNextRpcClient` (client components) both call
 * {@link makeQueryClient} by default, so prefetched queries are dehydrated, streamed and hydrated
 * with the same defaults on both sides of the RSC boundary.
 *
 * @since 0.1.0
 */
import { defaultShouldDehydrateQuery, QueryClient } from '@tanstack/react-query';
import type { QueryClientConfig } from '@tanstack/react-query';

/**
 * Creates a `QueryClient` with the defaults the App Router needs (tRPC's `makeQueryClient`).
 *
 * **When to use**
 *
 * Use it (or let `createRscHelpers` / `createNextRpcClient` call it for you) whenever a query
 * client is created in a Next.js app. Pass your own factory as `makeQueryClient` to those helpers
 * when you need other defaults; start from this one so dehydration keeps working.
 *
 * **Details**
 *
 * - `queries.staleTime` is `30s`, so the browser does not immediately refetch what the server
 *   just prefetched.
 * - `dehydrate.shouldDehydrateQuery` also includes **pending** queries, so `prefetch` does not
 *   need `await`: the promise streams to the client with the RSC payload, and its resolved data
 *   is Schema-encoded like any other query.
 * - `dehydrate.shouldRedactErrors` returns `false`: Next.js detects dynamic rendering through
 *   thrown errors and redacts error messages in production itself.
 * - No `serializeData` / `deserializeData` transformer is configured: `HydrateClient` and the
 *   effect-trpc `HydrationBoundary` encode with the procedures' schemas instead.
 * - `config` is spread over these defaults; `defaultOptions.queries` and
 *   `defaultOptions.dehydrate` are merged key by key, everything else is replaced.
 *
 * **Gotchas**
 *
 * - Never share one `QueryClient` between server requests (e.g. a module-level
 *   `makeQueryClient()` in a server file): cached data would leak between users. Server code
 *   calls the factory per request (`createRscHelpers` memoizes it with `React.cache`).
 * - Overriding `dehydrate.shouldDehydrateQuery` replaces the pending-query rule; un-awaited
 *   `prefetch` calls then no longer reach the client.
 * - When a pending query **fails while streaming**, React serializes the rejection as a plain
 *   `Error` and the `TaggedError` class is lost. `await` the prefetch when a page needs typed
 *   errors.
 *
 * **Example** (Customising the defaults of the RSC helpers)
 *
 * ```ts
 * // trpc/query-client.ts — imported by server and client code
 * import { makeQueryClient } from '@effect-trpc/next';
 *
 * // Keep the effect-trpc dehydration defaults; only change what the app needs.
 * export const makeAppQueryClient = () =>
 *   makeQueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: false } } });
 *
 * // Then: createRscHelpers(appRouter, source, { makeQueryClient: makeAppQueryClient })
 * // and:  createNextRpcClient(appRouter, { makeQueryClient: makeAppQueryClient })
 * ```
 *
 * @see {@link https://trpc.io/docs/client/tanstack-react-query/server-components tRPC server components guide}
 * @category constructors
 * @since 0.1.0
 */
export const makeQueryClient = (config: QueryClientConfig = {}): QueryClient =>
  new QueryClient({
    ...config,
    defaultOptions: {
      ...config.defaultOptions,
      queries: { staleTime: 30 * 1000, ...config.defaultOptions?.queries },
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
        shouldRedactErrors: () => false,
        ...config.defaultOptions?.dehydrate,
      },
    },
  });
