# @effect-trpc/start

[TanStack Start](https://tanstack.com/start) integration for [`@effect-trpc`](../../README.md)
routers. It follows the layout of TanStack Start's `with-trpc` example:

- **`createStartHandler`**: a server route handler for `src/routes/api/rpc.$.ts`
  (`server.handlers.POST`).
- **`createIsomorphicClient`**: one client that runs the handlers in-process on the server
  (loaders, SSR) and uses `httpLink` in the browser. Both sides return real `Schema.Class`
  instances and `Schema.TaggedError` instances.
- **`createStartHelpers`**: the TanStack Query options proxy for route loaders
  (`rpc(context.queryClient)`), the React provider and hooks, and Schema-aware SSR hydration.

`@tanstack/react-start` is only imported as types, so this package has no Start runtime
dependency.

```sh
pnpm add @effect-trpc/start @effect-trpc/core @effect-trpc/server @effect-trpc/client @effect-trpc/tanstack-react-query effect @tanstack/react-query
# already in a Start app: @tanstack/react-start @tanstack/react-router react
```

## 1. Router and handlers

```ts
// src/rpc/router.ts — shared by server and browser
import { mutation, query, Router } from '@effect-trpc/core';
import { Schema } from 'effect';

export class Post extends Schema.Class<Post>('Post')({
  id: Schema.Number,
  title: Schema.String,
  createdAt: Schema.Date,
}) {
  shout(): string {
    return `${this.title.toUpperCase()}!`;
  }
}

export class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.Number,
}) {}

export const appRouter = Router.make({
  post: {
    byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }),
    create: mutation({ payload: { title: Schema.String }, success: Post }),
  },
});
export type AppRouter = typeof appRouter;
```

```ts
// src/rpc/handlers.server.ts — server only
import { Handlers } from '@effect-trpc/server';
import { Effect } from 'effect';
import { appRouter, Post, PostNotFound } from './router';

export const HandlersLive = Handlers.make(appRouter, {
  post: {
    byId: ({ id }) =>
      id === 1
        ? Effect.succeed(new Post({ id, title: 'Hello', createdAt: new Date() }))
        : Effect.fail(new PostNotFound({ id })),
    create: ({ title }) => Effect.succeed(new Post({ id: 2, title, createdAt: new Date() })),
  },
});
```

## 2. The server route: `src/routes/api/rpc.$.ts`

```ts
import { createFileRoute } from '@tanstack/react-router';
import { createStartHandler } from '@effect-trpc/start';
import { appRouter } from '~/rpc/router';
import { HandlersLive } from '~/rpc/handlers.server';

const handler = createStartHandler(appRouter, { handlers: HandlersLive /*, path: '/api/rpc' */ });

export const Route = createFileRoute('/api/rpc/$')({
  server: { handlers: { POST: handler, GET: handler } },
});
```

- `path` (default `"/api/rpc"`) is the route path without the `$` splat. Requests to it or to
  any path below it (`/api/rpc/whatever`) are rewritten to the rpc endpoint. Other paths get a
  `404` JSON body. If the router has a `basepath`, include it.
- The `effect/rpc` HTTP protocol only uses `POST`. Any other method (including the `GET` key
  above) gets a `405` JSON body with `Allow: POST`, so registering it under `GET` is safe and
  gives a clear answer to someone opening the url in a browser.
- The handler layer is built lazily on the first request and shared after that. If the build
  fails, that request rejects (Start answers `500`) and the next request tries again.
  `handler.dispose()` releases the layer.
- Typed failures and defects are encoded into the response `Exit` with status `200`.
  Subscriptions stream NDJSON. `serialization: 'json' | 'ndjson'` must match the client.

## 3. The client: `src/rpc/client.ts`

```ts
import { createIsomorphicClient, createStartHelpers } from '@effect-trpc/start';
import { appRouter } from './router';
import { HandlersLive } from './handlers.server';

export const client = createIsomorphicClient(appRouter, {
  server: { handlers: HandlersLive }, // isServer: in-process, no HTTP, no serialization
  client: { url: '/api/rpc' }, // browser: httpLink (relative urls are resolved, see below)
  // isServer: defaults to typeof window === 'undefined'
});

export const { rpc, RpcProvider, useRpc, useRpcClient, hydration } = createStartHelpers(appRouter, {
  client,
});
```

Importing `HandlersLive` into a module the browser also loads puts the server code in the client
bundle. To keep it server-only, build the two halves with Start's `createIsomorphicFn`. Start's
compiler removes the `.server()` branch from the client build:

```ts
import { createIsomorphicFn } from '@tanstack/react-start';
import { createBrowserClient, createServerClient } from '@effect-trpc/start';

const makeClient = createIsomorphicFn()
  .server(() => createServerClient(appRouter, { handlers: HandlersLive }))
  .client(() => createBrowserClient(appRouter, { url: '/api/rpc' }));
export const client = makeClient();
```

The server needs absolute urls. If you call the HTTP endpoint from the server (`isServer: false`
or `createBrowserClient` during SSR), relative urls are resolved with `getBaseUrl()`:
`window.location.origin` in the browser. On the server it uses `serverOrigin`, then
`PUBLIC_URL` / `URL`, then `https://$VERCEL_URL`, then `http://localhost:$PORT` (port `3000` by
default). You can also pass an absolute `url`.

## 4. The router: `src/router.tsx`

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { client, hydration, RpcProvider } from './rpc/client';

export function getRouter() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    // Schema-aware SSR hand-off of the query cache: dehydrated on the server after the loaders,
    // hydrated into the same QueryClient in the browser.
    ...hydration.routerOptions(queryClient),
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <RpcProvider client={client} queryClient={queryClient}>
          {children}
        </RpcProvider>
      </QueryClientProvider>
    ),
  });
}
```

### SSR and `@tanstack/react-router-ssr-query`

`setupRouterSsrQueryIntegration({ router, queryClient })` serializes the cache with Start's own
serializer. That serializer does not know your `Schema.Class` instances, `Date` fields inside
them, or `TaggedError`s. `hydration.routerOptions(queryClient)` replaces it for the queries of
your rpc router:

- `dehydrate` encodes each query's data (and error) with the procedure's schema (`createdAt` →
  ISO string).
- `hydrate` decodes it back into instances. Methods still work, `createdAt` is a `Date`, and a
  failed query's error is a `PostNotFound`.

Queries with other keys are passed through unchanged.

The payload covers what the loaders put in the cache (the `ensureQueryData` pattern below). If
you also want the ssr-query integration (for example to stream queries started during render),
make sure rpc data does not go through two serializers. You can use the lower-level
`hydration.dehydrate(queryClient)` / `hydration.hydrate(queryClient, state)` (or
`createStartHydration(appRouter)`) in your own hooks. **Not tested against
`@tanstack/react-router-ssr-query`**, which is not installed in this repository.

## 5. Providers in `src/routes/__root.tsx`

```tsx
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => <Outlet />, // RpcProvider / QueryClientProvider come from the router's Wrap
});
```

## 6. A route with a loader: `src/routes/posts.$postId.tsx`

```tsx
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { rpc, useRpc } from '~/rpc/client';

export const Route = createFileRoute('/posts/$postId')({
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(
      rpc(context.queryClient).post.byId.queryOptions({ id: Number(params.postId) }),
    );
  },
  component: PostPage,
});

function PostPage() {
  const { postId } = Route.useParams();
  const { data: post } = useSuspenseQuery(useRpc().post.byId.queryOptions({ id: Number(postId) }));
  return <h1>{post.shout()}</h1>; // a real Post instance, also after SSR hydration
}
```

On the server the loader runs in-process. During client-side navigation it calls `/api/rpc`
over `httpLink`. The same `rpc(queryClient)` options are used either way. The loader **awaits
and does not return** the data, like the official `with-trpc` example. The data reaches the
browser through the query cache, which `hydration` encodes with the procedure schema. Loader
return values go through Start's serializer instead, and it does not know `Schema.Class`.

`rpc(queryClient)` is memoized per `QueryClient`, and `getRpc` is an alias. To prefix every key,
use `createStartHelpers<AppRouter, { keyPrefix: true }>(appRouter, { client, keyPrefix: 'blog' })`.

### Typed errors

`ensureQueryData` rejects with the procedure's `TaggedError` instance (`PostNotFound`). During
SSR, though, an error thrown by a loader reaches `errorComponent` through Start's serializer and
can lose its class. On SSR'd pages, use `prefetchQuery` instead, which never throws. The failed
query and its encoded error are dehydrated, and the browser gets a real `PostNotFound` back.
Then narrow by `_tag`:

```tsx
import { useQuery } from '@tanstack/react-query';
import type { ClientError } from '@effect-trpc/client';
import type { PostNotFound } from '~/rpc/router';

export const Route = createFileRoute('/drafts/$postId')({
  loader: async ({ context, params }) => {
    await context.queryClient.prefetchQuery(
      rpc(context.queryClient).post.byId.queryOptions({ id: Number(params.postId) }),
    );
  },
  component: DraftPage,
});

function DraftPage() {
  const { postId } = Route.useParams();
  const query = useQuery(useRpc().post.byId.queryOptions({ id: Number(postId) }));
  if (query.error !== null) return <p>{describeError(query.error)}</p>; // ClientError<PostNotFound>
  return <h1>{query.data?.shout() ?? 'Loading'}</h1>;
}

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
```

These snippets are type-checked, and run through a real `@tanstack/react-router` router
(`router.load()` → `dehydrate` → `hydrate`), in `test/app.tsx` and `test/readme.test.ts`.

## Server functions

You can call the router from a `createServerFn` handler with `createServerClient` or
`createCaller` from `@effect-trpc/server`. The server function then becomes the transport, and
its return value goes through Start's serializer, not the procedure schemas. This package does
not provide a server-function link.

## API

| export                                                                                   | what                                                                     |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `createStartHandler(router, { handlers, path?, serialization? })`                        | `StartHandler`: `({ request }) => Promise<Response>` with `dispose()`    |
| `createIsomorphicClient(router, { server: { handlers }, client: { url }, isServer? })`   | `Client<R>`: in-process on the server, `httpLink` in the browser         |
| `createServerClient(router, { handlers, headers? })`                                     | `Client<R>` over `localLink`                                             |
| `createBrowserClient(router, { url?, headers?, fetch?, serialization?, serverOrigin? })` | `Client<R>` over `httpLink` (relative url resolved)                      |
| `getBaseUrl({ serverOrigin? })` / `getRpcUrl(url?, { serverOrigin? })`                   | origin / absolute rpc url for SSR and the browser                        |
| `createStartHelpers(router, { client, keyPrefix? })`                                     | `{ rpc, getRpc, client, RpcProvider, useRpc, useRpcClient, hydration }`  |
| `createStartHydration(router)`                                                           | `{ dehydrate(qc), hydrate(qc, state), routerOptions(qc) }`, Schema-aware |
