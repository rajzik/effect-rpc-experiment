// app/page.tsx — a server component
import { caller, HydrateClient, prefetch, rpc } from '../trpc/server';

import { PostView } from './post-view';

export default async function Page() {
  // Fire and forget: the pending query streams to the client with the RSC payload.
  prefetch(rpc.post.byId.queryOptions({ id: 1 }));

  // Or read data directly on the server (no cache), with typed errors.
  const health = await caller.$promise.health();

  return (
    <HydrateClient>
      <p>API: {health}</p>
      <PostView id={1} />
    </HydrateClient>
  );
}
