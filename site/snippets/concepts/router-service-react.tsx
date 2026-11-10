import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { createClient, httpLink, type Client } from '@rpc-effect/client';
import { Router } from '@rpc-effect/core';
import { createRpcContext } from '@rpc-effect/tanstack-react-query';

import { AppRouter } from './router-service';

// #region react
// Helper types take a router *type*: map the class with `Router.Of`.
export const { RpcProvider, useRpc } = createRpcContext<typeof AppRouter>();

export type AppClient = Client<Router.Of<typeof AppRouter>>;

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [client] = useState<AppClient>(() =>
    createClient(AppRouter, { link: httpLink({ url: 'http://localhost:3000/rpc' }) }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <RpcProvider client={client} queryClient={queryClient}>
        {children}
      </RpcProvider>
    </QueryClientProvider>
  );
}

export function PostTitle({ id }: { id: number }) {
  const rpc = useRpc();
  const post = useQuery(rpc.post.byId.queryOptions({ id }));
  if (post.error?._tag === 'PostNotFound') return <p>No post #{post.error.id}</p>;
  return <h1>{post.data?.title ?? 'Loading…'}</h1>;
}
// #endregion react
