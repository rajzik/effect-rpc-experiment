import { QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient, httpLink } from '@effect-trpc/client';
import { createRpcOptionsProxy } from '@effect-trpc/tanstack-react-query';

import { appRouter } from '@/router';

import { useRpc } from './rpc';

// #region mutation
export function CreatePost() {
  const rpc = useRpc();
  const queryClient = useQueryClient();
  const create = useMutation(
    rpc.post.create.mutationOptions({
      onSuccess: (post) => {
        queryClient.setQueryData(rpc.post.byId.queryKey({ id: post.id }), post);
        return queryClient.invalidateQueries(rpc.post.list.pathFilter());
      },
    }),
  );
  // create.error: Forbidden | Unauthorized | RpcDefect | RpcTransportError | RpcInterrupted | null
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate({ title: new FormData(event.currentTarget).get('title') as string });
      }}
    >
      <input name="title" />
      <button disabled={create.isPending}>Create</button>
      {create.error?._tag === 'Forbidden' && <p>Not allowed: {create.error.reason}</p>}
      {create.error?._tag === 'Unauthorized' && <p>Please sign in.</p>}
    </form>
  );
}
// #endregion mutation

// #region overrides
// Invalidate everything after any successful mutation, app-wide.
const queryClient = new QueryClient();
export const rpc = createRpcOptionsProxy({
  client: createClient(appRouter, { link: httpLink({ url: 'https://api.example.com/rpc' }) }),
  queryClient,
  overrides: {
    mutations: {
      onSuccess: async ({ originalFn, queryClient: qc }) => {
        await originalFn();
        await qc.invalidateQueries();
      },
    },
  },
});
// #endregion overrides
