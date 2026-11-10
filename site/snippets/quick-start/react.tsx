// App.tsx — the same procedures as TanStack Query options.
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { createClient, httpLink } from '@rpc-effect/client';
import { createRpcContext } from '@rpc-effect/tanstack-react-query';

import { appRouter, type AppRouter } from '@/router';

export const { RpcProvider, useRpc } = createRpcContext<AppRouter>();

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [client] = useState(() =>
    createClient(appRouter, { link: httpLink({ url: 'http://localhost:3000/rpc' }) }),
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
  // post.error: PostNotFound | RpcDefect | RpcTransportError | RpcInterrupted | null
  if (post.error?._tag === 'PostNotFound') return <p>No post #{post.error.id}</p>;
  if (post.error) return <p>Something went wrong: {post.error.message}</p>;
  return <h1>{post.data?.title ?? 'Loading…'}</h1>;
}
