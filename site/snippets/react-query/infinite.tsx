import { useInfiniteQuery } from '@tanstack/react-query';

import { useRpc } from './rpc';

export function PostList() {
  const rpc = useRpc();
  const posts = useInfiniteQuery(
    rpc.post.list.infiniteQueryOptions(
      {}, // the input without `cursor`; each page gets `cursor` = the page param
      {
        getNextPageParam: (page) => page.nextCursor, // page: PostPage
        initialCursor: 0, // the first page param (else the input's `cursor`)
      },
    ),
  );
  return (
    <>
      <ul>
        {posts.data?.pages.flatMap((page) =>
          page.items.map((post) => <li key={post.id}>{post.title}</li>),
        )}
      </ul>
      <button disabled={!posts.hasNextPage} onClick={() => posts.fetchNextPage()}>
        More
      </button>
    </>
  );
}
