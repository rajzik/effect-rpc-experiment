// src/routes/posts.$postId.tsx
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { rpc, useRpc } from '../rpc/client';

export const Route = createFileRoute('/posts/$postId')({
  // On the server: in-process. During client navigation: httpLink. Same options either way.
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(
      rpc(context.queryClient).post.byId.queryOptions({ id: Number(params.postId) }),
    ); // await, don't return: the data travels in the (Schema-encoded) query cache
  },
  component: PostPage,
});

function PostPage() {
  const { postId } = Route.useParams();
  const { data: post } = useSuspenseQuery(useRpc().post.byId.queryOptions({ id: Number(postId) }));
  return <h1>{post.slug}</h1>; // a Post instance, also after SSR hydration
}
