# Setup

`@rpc-effect/tanstack-react-query` turns a router into TanStack Query options, modeled on
`@trpc/tanstack-react-query`. You keep using `useQuery`, `useMutation` and the rest of TanStack
Query directly. The package only builds their options, keys and filters, with typed data and typed
errors.

## The context

<<< @/snippets/react-query/rpc.tsx

`createRpcContext<AppRouter>()` returns:

| Export           | What                                                                |
| ---------------- | ------------------------------------------------------------------- |
| `RpcProvider`    | provides the client and the query client to components              |
| `useRpc()`       | the options proxy: `rpc.post.byId.queryOptions(...)`, keys, filters |
| `useRpcClient()` | the client itself, for imperative calls in event handlers           |

Call it once per router, at module scope. `RpcProvider` takes `client`, `queryClient` and, for
[several routers on one query client](../advanced/multiple-routers), `keyPrefix`.

## Without React context

<<< @/snippets/react-query/no-context.ts

`createRpcOptionsProxy({ client, queryClient })` returns the same proxy as `useRpc()`. Use it in
route loaders, server code and module singletons.

::: warning Gotchas

- Create the `QueryClient` and the client once per browser session (`useState`), and once per
  request on the server, never per render.
- The retry policy matters: TanStack retries every error 3 times by default. Your typed errors and
  defects come back the same on retry, so retry `RpcTransportError` only.
- The proxy reads the router to know each procedure's kind: `queryOptions` exists on queries only,
  `mutationOptions` on mutations only, `infiniteQueryOptions` on queries with a `cursor` input.

:::

See also: [`createRpcContext`](/api/tanstack-react-query#createrpccontext),
[`createRpcOptionsProxy`](/api/tanstack-react-query#createrpcoptionsproxy).
