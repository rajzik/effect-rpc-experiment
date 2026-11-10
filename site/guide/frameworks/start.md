# TanStack Start

`@rpc-effect/start` wires a router into TanStack Start: a server route for the HTTP endpoint, an
isomorphic client (in-process on the server, `httpLink` in the browser), loader helpers and a
Schema-aware SSR hand-off of the query cache.

| File                      | What                                  |
| ------------------------- | ------------------------------------- |
| `src/routes/api/rpc.$.ts` | the HTTP endpoint                     |
| `src/rpc/client.ts`       | the isomorphic client and the helpers |
| `src/router.tsx`          | providers and SSR hydration           |
| `src/routes/*.tsx`        | loaders and components                |

The router and server modules are the ones from the [quick start](../quick-start).

## Server route

<<< @/snippets/start/routes/api/rpc.$.ts [src/routes/api/rpc.$.ts]

- `path` (default `"/api/rpc"`) is the route path without the `$` splat. Requests at or below it are
  served, other paths get a JSON `404`. If the router has a `basepath`, include it.
- Only `POST` is used by clients. Other methods get a JSON `405` with `Allow: POST`.
- The handler layer is built lazily on the first request and shared. If the build fails, that
  request answers `500` and the next one retries. `handler.dispose()` releases it.
- Typed failures and defects are encoded in the response with status `200`. Subscriptions stream
  NDJSON.
- `onError` is the option of `toWebHandler`, passed through, and a `Handlers.withContext` layer
  gets its request context: see [request, response, context](../server/http-context). Both apply
  to this route; the in-process server client runs its handlers without it, so give it handlers
  with no requirements.

## Isomorphic client

<<< @/snippets/start/rpc/client.ts [src/rpc/client.ts]

`createIsomorphicClient` picks the server half (`localLink` over `handlers`) or the browser half
(`httpLink`) at runtime. `createStartHelpers` returns:

| Export                                  | What                                                               |
| --------------------------------------- | ------------------------------------------------------------------ |
| `rpc(queryClient)`                      | the options proxy for that query client, memoized (alias `getRpc`) |
| `RpcProvider`, `useRpc`, `useRpcClient` | the React context, as in [setup](../react-query/setup)             |
| `hydration`                             | SSR hand-off: `routerOptions(queryClient)`, `dehydrate`, `hydrate` |

### Keeping server code out of the browser bundle

Importing `ServerLive` into a module the browser loads puts your server code in the client bundle.
Build the two halves with Start's `createIsomorphicFn`: its compiler strips the `.server()` branch
from the client build.

<<< @/snippets/start/rpc/client-split.ts [src/rpc/client.ts]

When the server calls the HTTP endpoint (`isServer: false`, or `createBrowserClient` during SSR),
relative URLs resolve with `getBaseUrl()`: `serverOrigin`, then `PUBLIC_URL` / `URL`, then
`https://$VERCEL_URL`, then `http://localhost:$PORT`. For a hand-made link (a `wsLink`, extra
headers), `getRpcUrl(url?)` applies the same rules; it defaults to `defaultStartPath`
(`"/api/rpc"`).

## Router and SSR hydration

<<< @/snippets/start/router.tsx [src/router.tsx]

<<< @/snippets/start/routes/__root.tsx [src/routes/__root.tsx]

Start's serializer does not know your `Schema.Class` instances or `TaggedError`s.
`hydration.routerOptions(queryClient)` replaces it for this router's queries: `dehydrate` encodes
each query's data and error with the procedure's schema, and `hydrate` decodes them back into
instances in the browser. Queries with other keys pass through unchanged.

## Loaders

<<< @/snippets/start/routes/posts.$postId.tsx [src/routes/posts.$postId.tsx]

On the server the loader runs in-process. During client-side navigation it calls `/api/rpc`. Await
the data in the loader and do not return it: loader return values go through Start's serializer,
while the query cache goes through the procedure's schemas.

### Typed errors

`ensureQueryData` rejects with the `PostNotFound` instance. During SSR, though, an error thrown by a
loader reaches `errorComponent` through Start's serializer and can lose its class. On SSR'd pages,
`prefetchQuery` (which never throws) and a `_tag` check in the component keep the class:

<<< @/snippets/start/routes/drafts.$postId.tsx [src/routes/drafts.$postId.tsx]

## Server functions

<<< @/snippets/start/server-fn.ts

A server function becomes the transport, so its return value goes through Start's serializer, not
the procedure's schemas. There is no server-function link: for typed results across the boundary,
use the HTTP endpoint.

::: warning Gotchas

- With `@tanstack/react-router-ssr-query`, make sure rpc data does not go through two serializers.
  `hydration.dehydrate` / `hydration.hydrate` are available for your own hooks. The combination is
  not covered by this package's tests.
- To prefix every key, use `createStartHelpers<AppRouter, { keyPrefix: true }>(appRouter, { client,
  keyPrefix: 'blog' })`.
- The router value (schemas) is imported by the browser. Keep it free of server code.

:::

## Full example

[`examples/start`](https://github.com/rajzik/effect-rpc-experiment/tree/main/examples/start) is a
TanStack Start app (server route, isomorphic client, loader prefetch and hydration, cookie sessions) tested in Chromium against the built output served by `vp preview`.

See also: [`createStartHandler`](/api/start#createstarthandler),
[`createIsomorphicClient`](/api/start#createisomorphicclient),
[`createStartHelpers`](/api/start#createstarthelpers),
[`createStartHydration`](/api/start#createstarthydration).
