// app/post-view.tsx
'use client';
import { useSuspenseQuery } from '@tanstack/react-query';

import { useRpc } from '../trpc/client';

export function PostView({ id }: { id: number }) {
  const rpc = useRpc();
  const { data } = useSuspenseQuery(rpc.post.byId.queryOptions({ id }));
  return <h1>{data.slug}</h1>; // a Post instance, hydrated from the server's prefetch
}
