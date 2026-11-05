// Without React context: loaders, server code, singletons.
import { QueryClient } from '@tanstack/react-query';
import { createClient, httpLink } from '@effect-trpc/client';
import { createRpcOptionsProxy } from '@effect-trpc/tanstack-react-query';

import { appRouter } from '@/router';

export const queryClient = new QueryClient();
const client = createClient(appRouter, { link: httpLink({ url: 'https://api.example.com/rpc' }) });

export const rpc = createRpcOptionsProxy({ client, queryClient });

// The same proxy `useRpc()` returns:
await queryClient.prefetchQuery(rpc.post.byId.queryOptions({ id: 1 }));
const post = queryClient.getQueryData(rpc.post.byId.queryKey({ id: 1 })); // Post | undefined
void post;
