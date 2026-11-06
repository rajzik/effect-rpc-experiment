# Infinite queries

A query whose input has a `cursor` key also gets `infiniteQueryOptions(input, options)` for
`useInfiniteQuery`. In the demo router, `post.list` takes
`{ cursor?: number | null }` and returns a `PostPage` with `nextCursor`.

<<< @/snippets/react-query/infinite.tsx

## How the cursor works

- The input you pass is the input without its cursor. The query key drops `cursor` too, so every
  page belongs to one cache entry.
- Each page is fetched with `cursor` set to that page's param.
- The first page param is `initialCursor`, or else the input's `cursor` (often `undefined`).
- `getNextPageParam` (and `getPreviousPageParam`) return the next cursor from a decoded page.

## Keys

`rpc.post.list.infiniteQueryKey(input)` is `[["post","list"], { input, type: "infinite" }]`. An
infinite query and a plain query of the same procedure are separate cache entries.

::: warning Gotchas

- Only queries with a `cursor` key in their input have `infiniteQueryOptions`. Name the field
  `cursor`, whatever its type.
- Unlike tRPC, no `direction` field is added to the input.
- During SSR, `dehydrate` encodes each page with the procedure's codec, so pages hydrate as class
  instances too.

:::

See also: [`DecorateInfiniteQueryProcedure`](/api/tanstack-react-query#decorateinfinitequeryprocedure).
