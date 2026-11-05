# Keys and filters

Every procedure has typed query keys and filters, in the same shape as tRPC's, so the
`QueryClient` API (`invalidateQueries`, `setQueryData`, `removeQueries`, `cancelQueries`, …) stays
typed.

## Keys

<<< @/snippets/react-query/keys.ts#keys

| Helper                             | Key                                        |
| ---------------------------------- | ------------------------------------------ |
| `rpc.x.y.queryKey(input?)`         | `[["x","y"], { input, type: "query" }]`    |
| `rpc.x.y.infiniteQueryKey(input?)` | `[["x","y"], { input, type: "infinite" }]` |
| `rpc.x.pathKey()`                  | `[["x"]]`: matches everything under `x`    |
| `rpc.pathKey()`                    | `[]`: every query of this router           |
| `rpc.x.y.mutationKey()`            | `[["x","y"]]`                              |

## Filters

<<< @/snippets/react-query/keys.ts#filters

| Helper                                  | Returns                    |
| --------------------------------------- | -------------------------- |
| `queryFilter(input?, filters?)`         | `{ ...filters, queryKey }` |
| `infiniteQueryFilter(input?, filters?)` | `{ ...filters, queryKey }` |
| `pathFilter(filters?)`                  | `{ ...filters, queryKey }` |

Without an input, `queryKey()` and `queryFilter()` match every input of that procedure.

## Key prefixes

To keep several routers on one `QueryClient` without key collisions, give each a prefix. Keys
become `[["billing"], ["list"], { … }]`. See [multiple routers](../advanced/multiple-routers).

::: warning Gotchas

- `pathKey()` on the root is `[]`, which matches every query in the client, including queries that
  are not from this router. With several routers, use prefixes.
- Keys contain the encoded-equal input, not the decoded one: keep inputs to plain data.

:::

See also: [`DecorateRouterKeyable`](/api/tanstack-react-query#decoraterouterkeyable).
