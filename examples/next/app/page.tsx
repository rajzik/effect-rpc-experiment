import { sessionOptions, taskListOptions } from '@rpc-effect-examples/shared/ui';

import { getQueryClient, HydrateClient, rpc } from '@/trpc/server';

import { Board } from './board';

// Reads the request's cookies: render on every request.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const queryClient = getQueryClient();
  // Awaited, so the server-rendered HTML already contains the user and the tasks.
  await Promise.all([
    queryClient.prefetchQuery(sessionOptions(rpc)),
    queryClient.prefetchInfiniteQuery(taskListOptions(rpc)),
  ]);
  return (
    <HydrateClient>
      <Board />
    </HydrateClient>
  );
}
