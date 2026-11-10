# @rpc-effect/start

[TanStack Start](https://tanstack.com/start) integration for [`@rpc-effect`](../../README.md)
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

Every function that takes a `router` also takes a router written as an Effect service
(`createStartHandler(AppRouter, { handlers: Handlers.fromService(AppRouter) })`,
`createIsomorphicClient(AppRouter, ...)`, `createStartHelpers(AppRouter, { client })`); the class
is normalised with `Router.from`.

## For AI agents

**Use this package when** you wire an `@rpc-effect/core` router into a **TanStack Start** app:
a catch-all server route, loaders that prefetch into the router-context `QueryClient`, and SSR
hydration that keeps `Schema.Class` / `TaggedError` instances.

- Next.js App Router → use `@rpc-effect/next`.
- Plain React without Start (Vite SPA) → `@rpc-effect/tanstack-react-query` + `@rpc-effect/client`.
- Any other fetch server → `toWebHandler` from `@rpc-effect/server`.

**Entry points** (all from `@rpc-effect/start`; no subpaths):

| export                                   | side    | what                                                                                        | source           |
| ---------------------------------------- | ------- | ------------------------------------------------------------------------------------------- | ---------------- |
| `createStartHandler`, `defaultStartPath` | server  | `({ request }) => Promise<Response>` + `dispose()` for `server.handlers` (`onError` option) | `src/handler.ts` |
| `createServerClient`                     | server  | `Client<R>` over `localLink` (handlers in-process)                                          | `src/client.ts`  |
| `createBrowserClient`                    | browser | `Client<R>` over `httpLink` (relative url resolved)                                         | `src/client.ts`  |
| `createIsomorphicClient`                 | both    | server → `createServerClient`, browser → `createBrowserClient`                              | `src/client.ts`  |
| `getBaseUrl`, `getRpcUrl`                | both    | app origin / absolute rpc url (SSR needs absolute urls)                                     | `src/client.ts`  |
| `createStartHelpers`                     | both    | `{ rpc, getRpc, client, RpcProvider, useRpc, useRpcClient, hydration }`                     | `src/helpers.ts` |
| `createStartHydration`                   | both    | `{ dehydrate, hydrate, routerOptions }`, Schema-aware                                       | `src/helpers.ts` |

**Golden path** (paths in the app):

1. `src/rpc/router.ts` — schemas-only router, shared (§1).
2. `src/rpc/handlers.server.ts` — `Handlers.make(appRouter, …)`, server only (§1).
3. `src/routes/api/rpc.$.ts` — `createStartHandler(appRouter, { handlers })` under
   `server.handlers.POST` (and `GET`) (§2).
4. `src/rpc/client.ts` — `createIsomorphicClient` (or `createIsomorphicFn` +
   `createServerClient` / `createBrowserClient` to keep handlers out of the browser bundle), then
   `createStartHelpers(appRouter, { client })` (§3).
5. `src/router.tsx` — a `QueryClient` per `getRouter()` call, `...hydration.routerOptions(queryClient)`,
   `Wrap` with `QueryClientProvider` + `RpcProvider client queryClient` (§4).
6. `src/routes/__root.tsx` — `createRootRouteWithContext<{ queryClient: QueryClient }>()` (§5).
7. Routes — loaders `await context.queryClient.ensureQueryData(rpc(context.queryClient).x.queryOptions(…))`
   (or `prefetchQuery` for typed errors on SSR'd pages); components `useSuspenseQuery(useRpc().x.queryOptions(…))` (§6).

**Invariants**

- `ClientError<E> = E | RpcDefect | RpcTransportError | RpcInterrupted`; narrow on `_tag`.
- Server-only: `createStartHandler`, `createServerClient`, and any module importing your handlers
  (including one calling `createIsomorphicClient`).
- `createStartHandler` requires `handlers`; `path` (default `"/api/rpc"`) is the route path
  without the `$` splat; `serialization` (default `"ndjson"`) must match the client.
- Non-`POST` requests get `405` (`Allow: POST`); other paths `404`; after `dispose()` `503`.
- Typed failures and defects are encoded in the response `Exit` with status `200`.
- `rpc(queryClient)` is memoized per `QueryClient`; `RpcProvider` needs `client` and
  `queryClient` props (and `keyPrefix` with the `{ keyPrefix: true }` flag).
- Relative browser-client urls are resolved with `getBaseUrl()`: `serverOrigin` → `PUBLIC_URL` /
  `URL` → `https://$VERCEL_URL` → `http://localhost:$PORT` on the server.
- `router` is a `Router.Input` (a `Router.make` router or a router service class); types use
  `Router.Of<X>`, so both forms infer the same clients and helpers. Type helpers
  (`StartHelpers<R>`, `ServerClientOptions<R>`, ...) take a router type:
  `Router.Of<typeof AppRouter>` for a service.

**Common mistakes**

- Don't create the `QueryClient` at module level → create it inside `getRouter()` (one per SSR
  request).
- Don't import `handlers.server.ts` into modules the browser loads unless you accept the bundle
  cost → use `createIsomorphicFn().server(…).client(…)`.
- Don't return rpc data from a loader → `await` `ensureQueryData` / `prefetchQuery`; loader return
  values go through Start's serializer, which does not know `Schema.Class`.
- Don't rely on a loader's thrown `TaggedError` reaching `errorComponent` during SSR → use
  `prefetchQuery` and read `query.error` in the component.
- Don't use `createBrowserClient` during SSR without an origin in production → set `PUBLIC_URL`,
  pass `serverOrigin`, or pass an absolute `url`.
- Don't give a `Handlers.withContext` layer to `createServerClient` / `createIsomorphicClient` →
  they run in-process through `localLink` without its context (calls needing its services die);
  provide the service to the layer you give them.
- Don't mount the handler on a path other than `path` → pass `path` (include the router
  `basepath`).
- Don't write `StartHelpers<typeof AppRouter>` for a router service →
  `StartHelpers<Router.Of<typeof AppRouter>>` (functions take the class itself).
- Don't combine `hydration.routerOptions` and `@tanstack/react-router-ssr-query` for the same rpc
  data → one serializer per query (the combination is not tested).

**Where to look**

- Route handler (encoding, NDJSON, rewrites, 405/404/503, lazy build, retry, `dispose`,
  `Handlers.withContext` and `onError`): `test/handler.test.ts`; the `withContext` types:
  `test/start.test-d.tsx`. The lazy build, retry and dispose rules live in `makeLazyWebHandler`
  (`@rpc-effect/server`, `packages/server/test/lazy-web-handler.test.ts`).
- Clients (`isServer` switching, `httpLink`, subscriptions, SSR url resolution):
  `test/client.test.ts`.
- Helpers (loader `ensureQueryData`, typed errors, dehydrate/hydrate, infinite queries,
  `keyPrefix`): `test/helpers.test.ts`.
- Router services (`typeof AppRouter`) in every function: `test/routerService.test.ts` /
  `test/routerService.test-d.ts`.
- This README wired with real `@tanstack/react-router` objects (`router.load()` → `dehydrate` →
  `hydrate`): `test/app.tsx`, `test/readme.test.ts`; types: `test/start.test-d.tsx`; tRPC parity:
  `test/PARITY.md`.
- JSDoc conventions: `docs/jsdoc-style.md`. Tests use Web `Request`s and router objects, not a
  running Start server or Vite build (so `createIsomorphicFn` stripping is not exercised).

**Verify**

```bash
pnpm exec vp -C packages/start test
pnpm exec vp -C packages/start pack
node scripts/verify-jsdoc.mjs start
```

```sh
pnpm add @rpc-effect/start @rpc-effect/core @rpc-effect/server @rpc-effect/client @rpc-effect/tanstack-react-query effect @tanstack/react-query
# already in a Start app: @tanstack/react-start @tanstack/react-router react
```

## 1. Router and handlers

```ts
// src/rpc/router.ts — shared by server and browser
import { mutation, query, Router } from '@rpc-effect/core';
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
import { Handlers } from '@rpc-effect/server';
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
import { createStartHandler } from '@rpc-effect/start';
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
  `handler.dispose()` releases the layer. This lifecycle is `makeLazyWebHandler` from
  `@rpc-effect/server`, shared with `@rpc-effect/next`.
- Typed failures and defects are encoded into the response `Exit` with status `200`.
  Subscriptions stream NDJSON. `serialization: 'json' | 'ndjson'` must match the client.
- `Handlers.withContext(handlers, context)` (tRPC's `createContext`: an `Effect` of services
  evaluated per call, before middleware and the handler) and `onError({ path, cause, headers })`,
  an option of `toWebHandler` from `@rpc-effect/server` passed through, apply to this route only:
  give the in-process `createServerClient` handlers with those services provided. Handlers can
  read the request and set response headers and cookies with `HttpContext` (`@rpc-effect/core`).

## 3. The client: `src/rpc/client.ts`

```ts
import { createIsomorphicClient, createStartHelpers } from '@rpc-effect/start';
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
import { createBrowserClient, createServerClient } from '@rpc-effect/start';

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
import type { ClientError } from '@rpc-effect/client';
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
    case '@rpc-effect/RpcDefect':
    case '@rpc-effect/RpcTransportError':
      return error.message;
    case '@rpc-effect/RpcInterrupted':
      return 'Cancelled';
  }
};
```

These snippets are type-checked, and run through a real `@tanstack/react-router` router
(`router.load()` → `dehydrate` → `hydrate`), in `test/app.tsx` and `test/readme.test.ts`.

## Server functions

You can call the router from a `createServerFn` handler with `createServerClient` or
`createCaller` from `@rpc-effect/server`. The server function then becomes the transport, and
its return value goes through Start's serializer, not the procedure schemas. This package does
not provide a server-function link.

## API

| export                                                                                   | what                                                                     |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `createStartHandler(router, { handlers, path?, serialization?, onError? })`              | `StartHandler`: `({ request }) => Promise<Response>` with `dispose()`    |
| `createIsomorphicClient(router, { server: { handlers }, client: { url }, isServer? })`   | `Client<R>`: in-process on the server, `httpLink` in the browser         |
| `createServerClient(router, { handlers, headers? })`                                     | `Client<R>` over `localLink`                                             |
| `createBrowserClient(router, { url?, headers?, fetch?, serialization?, serverOrigin? })` | `Client<R>` over `httpLink` (relative url resolved)                      |
| `getBaseUrl({ serverOrigin? })` / `getRpcUrl(url?, { serverOrigin? })`                   | origin / absolute rpc url for SSR and the browser                        |
| `createStartHelpers(router, { client, keyPrefix? })`                                     | `{ rpc, getRpc, client, RpcProvider, useRpc, useRpcClient, hydration }`  |
| `createStartHydration(router, { keyPrefix? })`                                           | `{ dehydrate(qc), hydrate(qc, state), routerOptions(qc) }`, Schema-aware |
