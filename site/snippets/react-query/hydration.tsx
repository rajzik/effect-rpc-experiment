import { QueryClient, type DehydratedState } from '@tanstack/react-query';
import { createClient, localLink, type Client } from '@rpc-effect/client';
import { createHydrationHelpers, createRpcOptionsProxy } from '@rpc-effect/tanstack-react-query';

import { appRouter, type AppRouter } from '@/router';
import { ServerLive } from '@/server';

import { PostView } from './queries';

// #region helpers
// One set of helpers per router (and key prefix).
export const { dehydrate, hydrate, HydrationBoundary } = createHydrationHelpers(appRouter);
// #endregion helpers

// #region server
// On the server (a loader, a server component, an SSR handler):
export async function loadPostPage(client: Client<AppRouter>, id: number) {
  const queryClient = new QueryClient();
  const rpc = createRpcOptionsProxy({ client, queryClient });
  await queryClient.prefetchQuery(rpc.post.byId.queryOptions({ id }));
  return dehydrate(queryClient); // JSON-safe: Post encoded, PostNotFound encoded
}

// SSR without the network: the same client shape over localLink.
const serverClient = createClient(appRouter, { link: localLink({ handlers: ServerLive }) });
export const dehydratedState = await loadPostPage(serverClient, 1);
// #endregion server

// #region client
// On the client: decoded back to a Post instance (or a PostNotFound) before rendering.
export function PostPage({ state, id }: { state: DehydratedState; id: number }) {
  return (
    <HydrationBoundary state={state}>
      <PostView id={id} />
    </HydrationBoundary>
  );
}
// #endregion client

// #region imperative
const browserQueryClient = new QueryClient();
hydrate(browserQueryClient, JSON.parse(JSON.stringify(dehydratedState)));
// #endregion imperative
