// rpc.tsx — one context per router, created at module scope.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { createClient, httpLink, RpcTransportError } from '@effect-trpc/client';
import { createRpcContext } from '@effect-trpc/tanstack-react-query';

import { appRouter, type AppRouter } from '@/router';

export const { RpcProvider, useRpc, useRpcClient } = createRpcContext<AppRouter>();

const makeQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // Typed errors and defects come back the same on retry: retry the network only.
        retry: (count, error) => error instanceof RpcTransportError && count < 3,
      },
    },
  });

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const [client] = useState(() =>
    createClient(appRouter, {
      link: httpLink({ url: new URL('/rpc', window.location.origin) }),
    }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <RpcProvider client={client} queryClient={queryClient}>
        {children}
      </RpcProvider>
    </QueryClientProvider>
  );
}
