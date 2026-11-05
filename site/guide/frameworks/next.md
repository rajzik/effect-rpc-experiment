# Next.js

`@effect-trpc/next` wires a router into the App Router: a route handler, a client provider, server
component helpers (prefetch, hydration, an in-process caller) and server actions with typed errors.
It follows tRPC's Next.js setup, file for file.

| File                              | What                                                  |
| --------------------------------- | ----------------------------------------------------- |
| `router.ts`                       | the router: schemas only, shared by server and client |
| `server.ts`                       | handlers and middleware: server only                  |
| `app/api/rpc/[[...rpc]]/route.ts` | the HTTP endpoint                                     |
| `trpc/client.tsx`                 | `'use client'`: provider and hooks                    |
| `trpc/server.tsx`                 | server component helpers                              |
| `app/actions.ts`                  | `'use server'`: server actions                        |

The router and server modules are the ones from the [quick start](../quick-start). Keep the server
module server-only (`import 'server-only'`): it holds handlers, database access and secrets.

## Route handler

<<< @/snippets/next/route.ts [app/api/rpc/[[...rpc]]/route.ts]

- Every call, subscriptions included, is a `POST` to one URL. `GET` answers `405` with
  `Allow: POST`, so probes get a clear answer.
- `path` defaults to `/api/rpc`. Requests at or below it are served, so `route.ts`, `[...rpc]` and
  `[[...rpc]]` all work. With a `basePath` in `next.config`, pass it as `basePath`.
- The handler layer is built lazily on the first request, then shared. If the build fails, that
  request answers 500 and the next one retries.
- The package does not import `next` at runtime: the exports are plain
  `(request: Request) => Promise<Response>` functions.

## Client provider

<<< @/snippets/next/trpc/client.tsx [trpc/client.tsx]

<<< @/snippets/next/app/layout.tsx [app/layout.tsx]

`RpcProvider` renders `QueryClientProvider` and the effect-trpc context. It creates a query client
with `makeQueryClient()` (a new one per request on the server, a singleton in the browser) and a
client over `httpLink`. A relative `url` resolves against `getBaseUrl()`: `window.location.origin`
in the browser, `https://$VERCEL_URL` on Vercel, otherwise `http://localhost:$PORT`.

Other options of `createNextRpcClient`: `headers`, `serialization`, `fetch`, `middleware`,
`makeQueryClient`, `keyPrefix`.

## RSC

<<< @/snippets/next/trpc/server.tsx [trpc/server.tsx]

| Export           | What                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------ |
| `getQueryClient` | `React.cache(makeQueryClient)`: one query client per request                         |
| `rpc`            | the options proxy over that query client, like `useRpc()`                            |
| `prefetch(opts)` | `prefetchQuery` / `prefetchInfiniteQuery`, fire and forget                           |
| `HydrateClient`  | renders the boundary with the dehydrated, Schema-encoded queries                     |
| `caller`         | (with `handlers`) reads data directly in a server component, without the query cache |

`handlers` runs the procedures in-process: no HTTP hop, no serialization. The in-process client and
`caller` share one runtime, so the handler layer is built once and `headers` apply to both. Pass
`{ client }` instead of `{ handlers }` to use an existing client, for example an `httpLink` to
another service.

<<< @/snippets/next/app/page.tsx [app/page.tsx]

<<< @/snippets/next/app/post-view.tsx [app/post-view.tsx]

### Streaming and typed errors

`makeQueryClient()` dehydrates pending queries too, so `prefetch` does not need `await`: the
promise streams to the client with the RSC payload, and its data is Schema-encoded when it
resolves. A query that **fails while streaming** reaches the client as a plain `Error`, because
React serializes the rejection itself. Queries that failed before `HydrateClient` rendered keep
their `TaggedError` class. When a page must show typed errors, `await` the prefetch:

```ts
await getQueryClient().prefetchQuery(rpc.post.byId.queryOptions({ id }));
```

## Server actions

A server action that throws reaches the client as a plain `Error`, without its class, its fields
and (in production) its message. effect-trpc actions never throw a procedure error: they resolve
with the encoded `Exit`, and the client decodes it into class instances.

<<< @/snippets/next/app/actions.ts [app/actions.ts]

<<< @/snippets/next/app/new-post.tsx#hook [app/new-post.tsx]

`useServerAction(action, { router, path })` returns `{ run, data, error, status, isPending, reset }`.
`run` never rejects: it resolves with the decoded `Exit`. `error` is `ClientError<E> | null`. Only
the latest `run` updates the state.

Without the hook:

<<< @/snippets/next/app/new-post.tsx#unwrap

| Helper                                         | Returns                                         |
| ---------------------------------------------- | ----------------------------------------------- |
| `actions(path)` / `actions.nested.post.create` | `(input) => Promise<EncodedActionResult<A, E>>` |
| `decodeActionResult(router, path, encoded)`    | `Exit<A, ClientError<E>>` of class instances    |
| `unwrapActionResult(router, path, encoded)`    | `Promise<A>`, rejecting with `ClientError<E>`   |
| `InputAt` / `OutputAt` / `ErrorAt<R, Path>`    | the types of a procedure at a path              |

- The input of an action comes from the network, so it is validated with the payload schema.
  Invalid input resolves with a defect.
- Defects keep their message only: no stack, no `cause` reaches the browser.
- Actions run through the caller, so middleware runs and the forwarded headers reach it.
  Subscriptions are not actions.

::: warning Gotchas

- Pass the `HydrationBoundary` from your `'use client'` module to `createRscHelpers`. A server
  component may only render client components that come from a `'use client'` module.
- `keyPrefix` must be the same in `createNextRpcClient` and `createRscHelpers`.
- The router value (its schemas) ships to the browser: decoding needs it. Keep it free of server
  code.
- In dev mode, each HMR re-evaluation of `route.ts` or `server.tsx` creates a new server; the old
  one is not disposed.
- `caller.dispose()` and the in-process client's `dispose()` shut down the same runtime.

:::

See also: [`createRouteHandler`](/api/next#createroutehandler),
[`createNextRpcClient`](/api/next#createnextrpcclient), [`createRscHelpers`](/api/next#createrschelpers),
[`createServerActionCaller`](/api/next#createserveractioncaller),
[`useServerAction`](/api/next#useserveraction).
