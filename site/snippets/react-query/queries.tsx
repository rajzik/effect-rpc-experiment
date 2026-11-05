import { skipToken, useQuery, useSuspenseQuery } from '@tanstack/react-query';

import { useRpc } from './rpc';

// #region query
export function PostView({ id }: { id: number }) {
  const rpc = useRpc();
  const post = useQuery(rpc.post.byId.queryOptions({ id }));
  // post.data:  Post | undefined
  // post.error: PostNotFound | RpcDefect | RpcTransportError | RpcInterrupted | null
  if (post.error) {
    switch (post.error._tag) {
      case 'PostNotFound':
        return <p>No post #{post.error.id}</p>;
      default:
        return <p>Something went wrong: {post.error.message}</p>;
    }
  }
  if (!post.data) return <p>Loading…</p>;
  return <h1>{post.data.title}</h1>; // a Post instance: post.data.slug works too
}
// #endregion query

// #region options
export function PostSlug({ id }: { id: number }) {
  const rpc = useRpc();
  const slug = useQuery(
    rpc.post.byId.queryOptions(
      { id },
      {
        select: (post) => post.slug, // every useQuery option works
        staleTime: 60_000,
        rpc: { headers: { 'x-trace-id': 'post-slug' } }, // per-request headers
      },
    ),
  );
  return <code>{slug.data}</code>;
}
// #endregion options

// #region skip
export function MaybePost({ id }: { id: number | undefined }) {
  const rpc = useRpc();
  // Type-safe disabling: no input until there is an id.
  const post = useQuery(rpc.post.byId.queryOptions(id === undefined ? skipToken : { id }));
  return <p>{post.data?.title ?? '—'}</p>;
}
// #endregion skip

// #region suspense
export function PostSuspense({ id }: { id: number }) {
  const rpc = useRpc();
  const { data: post } = useSuspenseQuery(rpc.post.byId.queryOptions({ id }));
  return <h1>{post.title}</h1>; // data is a Post, never undefined
}
// #endregion suspense
