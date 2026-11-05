import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';

import { client, hydration, RpcProvider } from './rpc/client';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    // Schema-aware SSR hand-off of the query cache: dehydrated on the server after the loaders
    // ran, hydrated into the same QueryClient in the browser.
    ...hydration.routerOptions(queryClient),
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <RpcProvider client={client} queryClient={queryClient}>
          {children}
        </RpcProvider>
      </QueryClientProvider>
    ),
  });
}
