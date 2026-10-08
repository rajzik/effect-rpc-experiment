# @effect-trpc/tanstack-react-query

[TanStack React Query](https://tanstack.com/query) integration for
[`@effect-trpc`](../../README.md) routers. It is a port of
[`@trpc/tanstack-react-query`](https://trpc.io/docs/client/tanstack-react-query/setup): you get a
typed **options proxy** that mirrors your router and produces plain TanStack Query options, so
you use the normal TanStack hooks (`useQuery`, `useMutation`, `useInfiniteQuery`,
`useSuspenseQuery`, ...) and the normal `QueryClient` methods.

- `data` has the procedure's output type. `Schema.Class` values are real instances, so methods
  work and `Date` fields are `Date`.
- `error` is `ClientError<E>`: one of the procedure's own `Schema.TaggedError`s, or `RpcDefect`,
  `RpcTransportError` or `RpcInterrupted`. Narrow it by `_tag`. It is never a generic wrapper.
- Query keys are data-tagged, so `queryClient.getQueryData(rpc.post.byId.queryKey({ id: 1 }))`
  is typed.
- TanStack's abort signal is passed to the call, so cancelling a query interrupts the server
  handler.
- SSR hydration encodes values with the procedures' schemas, so class instances and typed errors
  come back as instances on the client.

```sh
pnpm add @effect-trpc/tanstack-react-query @effect-trpc/client @effect-trpc/core effect @tanstack/react-query react
```

## 1. Define the router

```ts
import { mutation, query, Router, subscription } from '@effect-trpc/core';
import { Schema } from 'effect';

export class Post extends Schema.Class<Post>('Post')({
  id: Schema.Number,
  title: Schema.String,
  createdAt: Schema.Date,
}) {
  get headline(): string {
    return `${this.title} (${this.createdAt.getUTCFullYear()})`;
  }
}

export class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.Number,
}) {}

export const appRouter = Router.make({
  post: {
    byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }),
    // a `cursor` in the input enables `infiniteQueryOptions`
    list: query({
      payload: { cursor: Schema.optional(Schema.NullOr(Schema.Number)) },
      success: Schema.Struct({
        items: Schema.Array(Post),
        nextCursor: Schema.NullOr(Schema.Number),
      }),
    }),
    create: mutation({ payload: { title: Schema.String }, success: Post }),
  },
  countdown: subscription({ payload: { from: Schema.Number }, success: Schema.Number }),
});
export type AppRouter = typeof appRouter;
```

## 2. Set up the context provider

`createRpcContext` corresponds to tRPC's `createTRPCContext`. Call it once per router, at module
scope:

```tsx
import { createClient, httpLink, RpcTransportError } from '@effect-trpc/client';
import { createRpcContext } from '@effect-trpc/tanstack-react-query';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export const { RpcProvider, useRpc, useRpcClient } = createRpcContext<AppRouter>();

export function App({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // retry network failures only: typed errors and defects will not change on retry
        defaultOptions: { queries: { retry: (n, e) => e instanceof RpcTransportError && n < 3 } },
      }),
  );
  const [client] = useState(() =>
    createClient(appRouter, { link: httpLink({ url: 'http://localhost:3000/rpc' }) }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <RpcProvider client={client} queryClient={queryClient}>
        {children}
      </RpcProvider>
    </QueryClientProvider>
  );
}
```

If you don't use React context (loaders, server code, a singleton), use
`createRpcOptionsProxy({ client, queryClient })`. It returns the same proxy that `useRpc()`
gives you.

## 3. Queries, with errors narrowed by `_tag`

```tsx
import { useQuery } from '@tanstack/react-query';

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
  return <h1>{post.data.headline}</h1>;
}
```

`queryOptions(input, opts)` accepts every `useQuery` option (`select`, `initialData`,
`staleTime`, ...). It also accepts `rpc: { headers }` for per-request headers. The result carries
`rpc.path` (`"post.byId"`). Pass `skipToken` as the input to disable a query in a type-safe way:
`rpc.post.byId.queryOptions(id === undefined ? skipToken : { id })`. Without `skipToken` the
result also works with `useSuspenseQuery`.

## 4. Mutations and invalidation

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';

export function CreatePost() {
  const rpc = useRpc();
  const queryClient = useQueryClient();
  const create = useMutation(
    rpc.post.create.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(rpc.post.pathFilter()),
    }),
  );
  return <button onClick={() => create.mutate({ title: 'Hello' })}>Create</button>;
}
```

The helpers for keys and filters are the same as tRPC's:

| helper                                          | key                                                      |
| ----------------------------------------------- | -------------------------------------------------------- |
| `rpc.post.byId.queryKey({ id: 1 })`             | `[["post","byId"], { input: { id: 1 }, type: "query" }]` |
| `rpc.post.list.infiniteQueryKey({})`            | `[["post","list"], { input: {}, type: "infinite" }]`     |
| `rpc.post.pathKey()` / `rpc.pathKey()`          | `[["post"]]` / `[]` (every query)                        |
| `rpc.post.create.mutationKey()`                 | `[["post","create"]]`                                    |
| `queryFilter(input?, filters?)`, `pathFilter()` | `{ ...filters, queryKey }`                               |

To share one `QueryClient` between several routers, give each its own key prefix:
`createRpcContext<BillingRouter, { keyPrefix: true }>()` together with
`<RpcProvider keyPrefix="billing" …>`. Keys then become `[["billing"], ["list"], {...}]`.

`createRpcOptionsProxy({ ..., overrides: { mutations: { onSuccess } } })` wraps the `onSuccess`
of every mutation, for example to invalidate everything after any mutation. The wrapper receives
`{ originalFn, queryClient, meta }`.

## 5. Infinite queries

These are only available when the input has a `cursor` key. Each page is fetched with `cursor`
set to the page param:

```tsx
import { useInfiniteQuery } from '@tanstack/react-query';

export function PostList() {
  const rpc = useRpc();
  const posts = useInfiniteQuery(
    rpc.post.list.infiniteQueryOptions({}, { getNextPageParam: (page) => page.nextCursor }),
  );
  return (
    <ul>
      {posts.data?.pages.flatMap((page) => page.items.map((p) => <li key={p.id}>{p.title}</li>))}
    </ul>
  );
}
```

`initialCursor` sets the first page param. Otherwise the first page param is the input's
`cursor`.

## 6. Subscriptions

```tsx
import { useSubscription } from '@effect-trpc/tanstack-react-query';

export function Countdown() {
  const rpc = useRpc();
  const sub = useSubscription(
    rpc.countdown.subscriptionOptions({ from: 3 }, { onData: (n) => console.log(n) }),
  );
  // sub.status: 'idle' | 'connecting' | 'pending' | 'error'; sub.data: the last element
  return <p>{sub.status === 'error' ? sub.error.message : (sub.data ?? '…')}</p>;
}
```

The subscription restarts when its input changes or when `enabled` flips. It is aborted on
restart and on unmount, which interrupts the server stream. `sub.reset()` starts it again. Pass
`skipToken` or `enabled: false` to keep it `idle`. Callbacks: `onStarted`, `onData`, `onError`,
`onComplete`, `onConnectionStateChange`. Outside React, `subscriptionOptions(...).subscribe({
onData, signal })` returns an unsubscribe function.

## 7. SSR hydration with class instances

TanStack's `dehydrate` would put `Post` instances and `TaggedError`s into the payload as-is. They
would not survive JSON. `createHydrationHelpers(router)` encodes the router's queries with
`Codecs.success` (each page for infinite queries) and encodes their errors with `Codecs.exit`.
On the client it decodes them back to instances. Queries with other keys pass through unchanged.

```tsx
import { createHydrationHelpers, createRpcOptionsProxy } from '@effect-trpc/tanstack-react-query';

export const { dehydrate, HydrationBoundary } = createHydrationHelpers(appRouter);

// on the server (loader / server component)
export async function loadPostPage(client: Client<AppRouter>, id: number) {
  const queryClient = new QueryClient();
  const rpc = createRpcOptionsProxy({ client, queryClient });
  await queryClient.prefetchQuery(rpc.post.byId.queryOptions({ id }));
  return dehydrate(queryClient); // JSON-safe; failed queries are included (dehydrateErrors)
}

// on the client
export function PostPage({ state, id }: { state: DehydratedState; id: number }) {
  return (
    <HydrationBoundary state={state}>
      <PostView id={id} />
    </HydrationBoundary>
  );
}
```

`dehydrate(queryClient, options)` accepts TanStack's options (`shouldDehydrateQuery`,
`serializeData`, ...) plus `dehydrateErrors: false`. Pending queries (streaming) are supported:
their promise resolves to encoded data. `hydrate(queryClient, state)` is the imperative version.
`dehydrate(router, ...)` and `hydrate(router, ...)` are also exported as standalone functions. A
dehydrated `RpcDefect` keeps its message but drops its server-side `cause`.

## Differences from `@trpc/tanstack-react-query`

- Names: `createRpcContext` → `{ RpcProvider, useRpc, useRpcClient }`, `createRpcOptionsProxy`,
  `.rpc.path`, and the `rpc: { headers }` request option. tRPC's equivalents are
  `TRPCProvider`, `.trpc.path` and `trpc: { context }`.
- `RpcProvider` takes `client` instead of `trpcClient`. There is no `router` + `ctx` mode: for
  server-side use, pass a client over `localLink`, which does not use the network.
- The abort signal is always passed. Unmounting the last observer of a running query cancels it,
  as TanStack documents for queries that consume the signal.
- Infinite queries do not add a `direction` field to the input.
- `error` is `ClientError<E>`, not a `TRPCClientError`. There is no error formatter or shape.
- Subscriptions are `pending` once the request has been handed to the transport. Links don't
  reconnect, so there is no `connecting` state after an error. `tracked()` / `lastEventId` are not
  supported.
- Async-iterable _query_ results (streamed queries) are not supported. Use a subscription.
