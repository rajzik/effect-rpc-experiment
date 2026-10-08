import { defaultShouldDehydrateQuery, QueryClient } from '@tanstack/react-query';
import type { QueryClientConfig } from '@tanstack/react-query';

/**
 * The `QueryClient` factory recommended for the App Router (tRPC's `makeQueryClient`):
 *
 * - `staleTime: 30s`, so the client does not refetch what the server just prefetched;
 * - `dehydrate.shouldDehydrateQuery` also includes **pending** queries, so `prefetch` does not
 *   need to be awaited: the promise streams to the client with the RSC payload (its resolved
 *   data is Schema-encoded like any other query);
 * - `dehydrate.shouldRedactErrors: () => false`: Next.js detects dynamic pages through thrown
 *   errors and redacts error messages in production itself.
 *
 * Unlike tRPC no `serializeData` / `deserializeData` transformer is needed: `HydrateClient` and
 * the effect-trpc `HydrationBoundary` encode with the procedures' schemas. `config` is merged
 * over these defaults.
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
