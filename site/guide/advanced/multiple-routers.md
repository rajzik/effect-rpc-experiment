# Multiple routers

An app can talk to several routers: a billing service and a support service, or a public and an
internal API. Each gets its own client. When they share one `QueryClient`, give each router a key
prefix, or queries with the same path (`item` here) overwrite each other in the cache.

## Two routers

<<< @/snippets/advanced/multiple-routers.tsx#routers

## Prefixed contexts

<<< @/snippets/advanced/multiple-routers.tsx#context

`createRpcContext<Router, { keyPrefix: true }>()` makes `keyPrefix` a required prop of that
provider. Keys become `[["billing"], ["item"], { input, type }]`.

## Invalidating one router

<<< @/snippets/advanced/multiple-routers.tsx#invalidate

## SSR

<<< @/snippets/advanced/multiple-routers.tsx#hydration

Each helper only dehydrates and hydrates the queries with its own prefix. Render one
`HydrationBoundary` per router.

| Where          | Pass the prefix                                                             |
| -------------- | --------------------------------------------------------------------------- |
| React context  | `createRpcContext<R, { keyPrefix: true }>()` + `<RpcProvider keyPrefix>`    |
| no context     | `createRpcOptionsProxy({ client, queryClient, keyPrefix })`                 |
| hydration      | `createHydrationHelpers(router, { keyPrefix })`                             |
| Next.js        | the same `keyPrefix` in `createNextRpcClient` and `createRscHelpers`        |
| TanStack Start | `createStartHelpers<R, { keyPrefix: true }>(router, { client, keyPrefix })` |

::: warning Gotchas

- Without a prefix, `rpc.pathKey()` is `[]` and matches every query in the client, including other
  routers'.
- Hydration helpers without the prefix skip prefixed queries entirely: they are not dehydrated.
- Merging the routers into one (`Router.merge`) is the alternative when both are served by the same
  server.

:::
