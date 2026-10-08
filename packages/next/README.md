# @effect-trpc/next

Next.js App Router integration for [effect-trpc](../../README.md). It follows tRPC's
[TanStack React Query + Server Components guide](https://trpc.io/docs/client/tanstack-react-query/server-components),
using an `@effect-trpc/core` router and Effect handlers:

| tRPC (`@trpc/server/adapters/fetch` + `@trpc/tanstack-react-query`)       | `@effect-trpc/next`                                                          |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `fetchRequestHandler` in `app/api/trpc/[trpc]/route.ts`                   | `createRouteHandler(router, { handlers })` → `{ GET, POST }`                 |
| `trpc/query-client.ts` `makeQueryClient()`                                | `makeQueryClient()` (exported)                                               |
| `trpc/server.tsx` (`getQueryClient`, `trpc`, `HydrateClient`, `prefetch`) | `createRscHelpers(router, { handlers }, { HydrationBoundary })`              |
| `trpc/client.tsx` (`createTRPCContext`, `TRPCReactProvider`)              | `createNextRpcClient(router)` → `{ RpcProvider, useRpc, HydrationBoundary }` |
| `experimental_createServerActionHandler` + `useAction`                    | `createServerActionCaller` + `useServerAction` / `unwrapActionResult`        |

What differs from tRPC: there is **no transformer**. `Schema.Class` values (with methods and
`Date` fields) and `Schema.TaggedError` failures are encoded with the procedures' own schemas
everywhere: on the wire, in the dehydrated RSC payload and in server action results. Client
components get real class instances, and errors are typed as `ClientError<E>`.

## Install

```bash
pnpm add @effect-trpc/next @effect-trpc/core @effect-trpc/server @effect-trpc/client \
  @effect-trpc/tanstack-react-query effect @tanstack/react-query
```

Peers: `next >= 15`, `react >= 18.2` (React 19 for `React.cache`), `@tanstack/react-query` 5.

## 1. Router and handlers

Keep the router (schemas only) in its own module. Client components import it to decode results.
Keep the handlers (database access, secrets) in a server-only module.

```ts
// server/router.ts — shared by server and client
import { mutation, query, Router } from '@effect-trpc/core';
import { Schema } from 'effect';

export class Post extends Schema.Class<Post>('Post')({
  id: Schema.Number,
  title: Schema.String,
  createdAt: Schema.Date,
}) {
  get headline() {
    return `${this.title} (${this.createdAt.getUTCFullYear()})`;
  }
}
export class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.Number,
}) {}
export class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {
  reason: Schema.String,
}) {}

export const appRouter = Router.make({
  post: {
    byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }),
    create: mutation({ payload: { title: Schema.String }, success: Post, error: Forbidden }),
  },
});
export type AppRouter = typeof appRouter;
```

```ts
// server/handlers.ts
import 'server-only';
import { Handlers } from '@effect-trpc/server';
import { Effect } from 'effect';
import { appRouter, Forbidden, Post, PostNotFound } from './router';

export const HandlersLive = Handlers.make(appRouter, {
  post: {
    byId: ({ id }) =>
      id === 1
        ? Effect.succeed(new Post({ id, title: 'Hello', createdAt: new Date() }))
        : Effect.fail(new PostNotFound({ id })),
    create: ({ title }, { headers }) =>
      headers['x-user'] === undefined
        ? Effect.fail(new Forbidden({ reason: 'sign in first' }))
        : Effect.succeed(new Post({ id: 2, title, createdAt: new Date() })),
  },
});
```

## 2. Route handler — `app/api/rpc/[[...rpc]]/route.ts`

```ts
import { createRouteHandler } from '@effect-trpc/next';
import { HandlersLive } from '~/server/handlers';
import { appRouter } from '~/server/router';

export const { GET, POST } = createRouteHandler(appRouter, { handlers: HandlersLive });
```

- effect-trpc clients send every call (including subscriptions, which stream NDJSON) as a `POST` to
  a single url. `GET` answers `405 Method Not Allowed` with `Allow: POST`. It is exported so that
  probes get a clear answer instead of Next's default.
- `path` defaults to `/api/rpc`. Requests at or below it are served, so `app/api/rpc/route.ts`,
  `[...rpc]` and `[[...rpc]]` all work. Other paths get a JSON `404`. If `next.config` sets a
  `basePath`, pass it as `basePath`.
- The handler layer is built **lazily on the first request**, then shared. If it fails to build,
  that request rejects (Next answers 500) and the next request retries. `dispose()` releases it.
- `serialization` (`"ndjson"` default, or `"json"`) must match the client.
- Both exports are `(request: Request) => Promise<Response>`, so they are valid Next route
  handlers (`NextRequest` extends `Request`). The package never imports `next` at runtime.

## 3. Query client — `makeQueryClient()`

`makeQueryClient(config?)` is tRPC's `trpc/query-client.ts`. It sets `staleTime: 30s`, and its
`dehydrate.shouldDehydrateQuery` also includes **pending** queries, so `prefetch` does not need
`await`: the promise streams to the client with the RSC payload. `shouldRedactErrors` returns
`false` because Next detects dynamic rendering through thrown errors and redacts messages in
production itself. No `serializeData` / `deserializeData` is needed.

Streaming caveat: when a pending query resolves, its data is Schema-encoded like any other data.
When it **fails while streaming**, React serializes the rejection as a plain `Error`, so the typed
error class is lost. Queries that failed before `HydrateClient` rendered are encoded and keep their
`TaggedError` class. If a page needs typed errors, `await` the prefetch:
`await getQueryClient().prefetchQuery(...)`.

## 4. Client provider — `trpc/client.tsx`

```tsx
'use client';
import { createNextRpcClient } from '@effect-trpc/next';
import { appRouter } from '~/server/router';

export const { RpcProvider, useRpc, useRpcClient, HydrationBoundary } = createNextRpcClient(
  appRouter,
  { url: '/api/rpc' },
);
```

```tsx
// app/layout.tsx
import { RpcProvider } from '~/trpc/client';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <RpcProvider>{children}</RpcProvider>
      </body>
    </html>
  );
}
```

`RpcProvider` renders `QueryClientProvider` and the effect-trpc context. It uses
`getQueryClient()`, which returns a new client per call on the server and a singleton in the
browser, and a client over `httpLink`. Relative urls resolve against `getBaseUrl()`:
`window.location.origin` in the browser, `https://$VERCEL_URL` on Vercel, otherwise
`http://localhost:$PORT`. `httpLink` needs an absolute url, even during SSR. Other options:
`headers`, `serialization`, `fetch`, `middleware`, `makeQueryClient`.

## 5. Server helpers — `trpc/server.tsx`

```tsx
import 'server-only';
import { createRscHelpers } from '@effect-trpc/next';
import { headers } from 'next/headers';
import { HandlersLive } from '~/server/handlers';
import { appRouter } from '~/server/router';
import { HydrationBoundary } from './client';

export const { getQueryClient, rpc, HydrateClient, prefetch, caller } = createRscHelpers(
  appRouter,
  // In-process: no HTTP hop, no serialization. Forward the request headers to middleware.
  { handlers: HandlersLive, headers: async () => await headers() },
  { HydrationBoundary },
);
```

- `getQueryClient` is `React.cache(makeQueryClient)`, so each request gets its own query client.
  Pass `makeQueryClient` to customize it, and `cache` to replace `React.cache` (useful in tests;
  outside RSC `React.cache` does not memoize).
- `rpc` is `createRpcOptionsProxy({ client, queryClient: getQueryClient })`, the same options proxy
  as `useRpc()`.
- `prefetch(options)` calls `prefetchInfiniteQuery` for infinite query options and
  `prefetchQuery` for the rest. It returns `void` (fire and forget), like tRPC's.
- `HydrateClient` renders `HydrationBoundary` with `dehydrate(router, getQueryClient())`. Schema
  data and typed errors are JSON-encoded in the RSC payload. **Pass the `HydrationBoundary` from
  your `'use client'` module**: a server component may only render client components that come
  from a `'use client'` module. The default (the package's own boundary) only works outside RSC,
  for example in tests.
- `caller` (only with `{ handlers }`) reads data directly in a server component, without the
  cache: `await caller.$promise.post.byId({ id: 1 })`.
- `{ client }` instead of `{ handlers }` uses an existing client, for example `httpLink` to
  another service.
- `keyPrefix` must match the client provider. `dehydrateOptions` are passed to `dehydrate`.

## 6. Page — `app/page.tsx`

```tsx
import { HydrateClient, prefetch, rpc } from '~/trpc/server';
import { PostView } from './post-view';

export default function Page() {
  prefetch(rpc.post.byId.queryOptions({ id: 1 }));
  return (
    <HydrateClient>
      <PostView id={1} />
    </HydrateClient>
  );
}
```

```tsx
// app/post-view.tsx
'use client';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useRpc } from '~/trpc/client';

export function PostView({ id }: { id: number }) {
  const rpc = useRpc();
  const { data } = useSuspenseQuery(rpc.post.byId.queryOptions({ id }));
  return <h1>{data.headline}</h1>; // data is a Post instance: getters and methods work
}
```

## 7. Server actions with typed errors

An error thrown by a server action reaches the client as a plain `Error`. It loses its class and
fields, and in production its message too. So an effect-trpc action never throws a procedure
error. It resolves with the **encoded `Exit`** (`Codecs.exit(rpc)`), and the client decodes it:

```ts
// app/actions.ts
'use server';
import { createServerActionCaller, type InputAt } from '@effect-trpc/next';
import { headers } from 'next/headers';
import { HandlersLive } from '~/server/handlers';
import { appRouter, type AppRouter } from '~/server/router';

const actions = createServerActionCaller(appRouter, {
  handlers: HandlersLive,
  headers: async () => await headers(),
});

export async function createPost(input: InputAt<AppRouter, 'post.create'>) {
  return actions('post.create')(input);
}
```

```tsx
// app/new-post.tsx
'use client';
import { useServerAction } from '@effect-trpc/next';
import { appRouter } from '~/server/router';
import { createPost } from './actions';

export function NewPost() {
  const create = useServerAction(createPost, { router: appRouter, path: 'post.create' });
  return (
    <form action={(form) => void create.run({ title: String(form.get('title')) })}>
      <input name="title" />
      <button disabled={create.isPending}>Create</button>
      {create.data && <p>Created {create.data.headline}</p>}
      {create.error?._tag === 'Forbidden' && <p>Forbidden: {create.error.reason}</p>}
    </form>
  );
}
```

- `actions(path)` (or `actions.nested.post.create`) returns `(input) => Promise<EncodedActionResult<A, E>>`.
  Each action is created once per path and runs the procedure in-process through `createCaller`,
  so middleware runs. Subscriptions are not actions.
- The input comes from the network, so it is **validated with the payload schema**. Invalid input
  resolves with a defect. Defects only keep their message (no stack, no `cause`).
- `decodeActionResult(router, path, encoded)` → `Exit<A, ClientError<E>>` of class instances.
- `unwrapActionResult(router, path, encodedOrPromise)` → `Promise<A>`, rejecting with a
  `ClientError<E>` instance, like a client call. If the action request itself fails, it rejects
  with `RpcTransportError`.
- `useServerAction(action, { router, path })` → `{ run, data, error, status, isPending, reset }`.
  `run` never rejects: it resolves with the decoded `Exit`. `error` is
  `ClientError<E> | null`, so `error._tag` narrows to the procedure's errors. Only the latest
  `run` updates the state.
- Types: `ServerAction<Def>`, `EncodedActionResult<A, E>`, `inferActionOutput`,
  `inferActionError`, `inferActionClientError`, `InputAt` / `OutputAt` / `ErrorAt<Router, Path>`.

Exported values in `'use server'` files must be async functions. Wrapping each action in an
`export async function`, as above, satisfies Next's checks and gives the action a name.

## Known limits

- The router value (schemas) ships to the browser. Decoding needs it, unlike tRPC's type-only
  client import.
- In dev mode, each HMR re-evaluation of `route.ts` / `server.tsx` creates a new lazily-built
  server. The old one is not disposed.
- `createRscHelpers({ handlers })` builds the handler layer once for the in-process client and
  once more for `caller`, if you use it.
- Next.js itself is only used for types (`NextRequest`) in the tests. Everything else is tested
  with Web `Request`s, jsdom and React Testing Library, not in a running Next.js app.
