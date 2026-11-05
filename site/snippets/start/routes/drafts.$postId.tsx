// src/routes/drafts.$postId.tsx — typed errors on SSR'd pages
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import type { ClientError } from '@effect-trpc/client';

import type { PostNotFound } from '@/router';

import { rpc, useRpc } from '../rpc/client';

export const Route = createFileRoute('/drafts/$postId')({
  // prefetchQuery never throws: the failed query is dehydrated with its encoded error.
  loader: async ({ context, params }) => {
    await context.queryClient.prefetchQuery(
      rpc(context.queryClient).post.byId.queryOptions({ id: Number(params.postId) }),
    );
  },
  component: DraftPage,
});

const describeError = (error: ClientError<PostNotFound>): string => {
  switch (error._tag) {
    case 'PostNotFound':
      return `No post #${error.id}`;
    case '@effect-trpc/RpcDefect':
    case '@effect-trpc/RpcTransportError':
      return error.message;
    case '@effect-trpc/RpcInterrupted':
      return 'Cancelled';
  }
};

function DraftPage() {
  const { postId } = Route.useParams();
  const query = useQuery(useRpc().post.byId.queryOptions({ id: Number(postId) }));
  if (query.error !== null) return <p>{describeError(query.error)}</p>; // a PostNotFound instance
  return <h1>{query.data?.title ?? 'Loading'}</h1>;
}
