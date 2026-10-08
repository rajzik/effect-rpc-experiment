// A miniature TanStack Start app, written like the README (and like the files the Start / Router
// generator produces), wired with real `@tanstack/react-router` APIs. Used by `readme.test.ts`
// and `start.test-d.tsx`.
import type { ClientError } from '@effect-trpc/client';
import {
  QueryClientProvider,
  useQuery,
  useSuspenseQuery,
  type QueryClient,
} from '@tanstack/react-query';
import {
  createFileRoute,
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
} from '@tanstack/react-router';
import type {} from '@tanstack/react-start'; // loads the `server` route option (types only)
import { createIsomorphicClient, createStartHandler, createStartHelpers } from '../src/index.js';
import { appRouter, makeFixture, type PostNotFound } from './fixtures.js';

export const fixture = makeFixture();

// src/server/rpc.ts — the server half (handlers layer) ------------------------------------------
export const rpcHandler = createStartHandler(appRouter, { handlers: fixture.handlers });

// src/rpc.ts — one client and the helpers, shared by loaders and components ---------------------
export const client = createIsomorphicClient(appRouter, {
  server: { handlers: fixture.handlers },
  client: { url: '/api/rpc' },
});
export const { rpc, RpcProvider, useRpc, hydration } = createStartHelpers(appRouter, { client });

// src/routes/__root.tsx ---------------------------------------------------------------------------
export interface RouterContext {
  readonly queryClient: QueryClient;
}
export const rootRoute = createRootRouteWithContext<RouterContext>()({});

// src/routes/api/rpc.$.ts -------------------------------------------------------------------------
const RpcRouteImport = createFileRoute('/api/rpc/$')({
  server: { handlers: { POST: rpcHandler, GET: rpcHandler } },
});

// src/routes/posts.$postId.tsx --------------------------------------------------------------------
const PostRouteImport = createFileRoute('/posts/$postId')({
  // await, do not return: the data reaches the browser through the query cache (Schema-encoded),
  // not through Start's loader-data serializer
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(
      rpc(context.queryClient).post.byId.queryOptions({ id: Number(params.postId) }),
    );
  },
  component: PostPage,
});

export function PostPage() {
  const { postId } = PostRouteImport.useParams();
  const { data: post } = useSuspenseQuery(useRpc().post.byId.queryOptions({ id: Number(postId) }));
  return <h1>{post.shout()}</h1>;
}

// src/routes/drafts.$postId.tsx — typed errors on an SSR'd page ------------------------------------
const DraftRouteImport = createFileRoute('/drafts/$postId')({
  // prefetchQuery never throws: a failure is cached (and dehydrated) with its typed error
  loader: async ({ context, params }) => {
    await context.queryClient.prefetchQuery(
      rpc(context.queryClient).post.byId.queryOptions({ id: Number(params.postId) }),
    );
  },
  component: DraftPage,
});

export const describeError = (error: ClientError<PostNotFound>): string => {
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

export function DraftPage() {
  const { postId } = DraftRouteImport.useParams();
  const query = useQuery(useRpc().post.byId.queryOptions({ id: Number(postId) }));
  if (query.error !== null) return <p>{describeError(query.error)}</p>;
  return <h1>{query.data?.shout() ?? 'Loading'}</h1>;
}

// src/routeTree.gen.ts (what the generator emits) -------------------------------------------------
export const RpcRoute = RpcRouteImport.update({
  id: '/api/rpc/$',
  path: '/api/rpc/$',
  getParentRoute: () => rootRoute,
} as never);
export const PostRoute = PostRouteImport.update({
  id: '/posts/$postId',
  path: '/posts/$postId',
  getParentRoute: () => rootRoute,
} as never);
export const DraftRoute = DraftRouteImport.update({
  id: '/drafts/$postId',
  path: '/drafts/$postId',
  getParentRoute: () => rootRoute,
} as never);
export const routeTree = rootRoute.addChildren([RpcRoute, PostRoute, DraftRoute]);

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/api/rpc/$': {
      id: '/api/rpc/$';
      path: '/api/rpc/$';
      fullPath: '/api/rpc/$';
      preLoaderRoute: typeof RpcRouteImport;
      parentRoute: typeof rootRoute;
    };
    '/posts/$postId': {
      id: '/posts/$postId';
      path: '/posts/$postId';
      fullPath: '/posts/$postId';
      preLoaderRoute: typeof PostRouteImport;
      parentRoute: typeof rootRoute;
    };
    '/drafts/$postId': {
      id: '/drafts/$postId';
      path: '/drafts/$postId';
      fullPath: '/drafts/$postId';
      preLoaderRoute: typeof DraftRouteImport;
      parentRoute: typeof rootRoute;
    };
  }
}

// src/router.tsx ----------------------------------------------------------------------------------
export const getRouter = (queryClient: QueryClient, initialPath = '/') =>
  createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    // Schema-aware SSR hand-off of the QueryClient cache (dehydrate on the server, hydrate in
    // the browser)
    ...hydration.routerOptions(queryClient),
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <RpcProvider client={client} queryClient={queryClient}>
          {children}
        </RpcProvider>
      </QueryClientProvider>
    ),
  });
