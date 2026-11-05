# SSR hydration

TanStack's `dehydrate` puts query data into the payload as it is. A `Post` instance becomes a plain
object after `JSON.stringify`, and a `PostNotFound` loses its class. effect-trpc's hydration helpers
encode the router's queries with the procedure's codecs on the server, and decode them on the
client, so components render the same instances on both sides.

## Helpers

<<< @/snippets/react-query/hydration.tsx#helpers

## Server: prefetch and dehydrate

<<< @/snippets/react-query/hydration.tsx#server

## Client: hydrate and render

<<< @/snippets/react-query/hydration.tsx#client

`HydrationBoundary` decodes the router's queries, then hands them to TanStack's own boundary.

## Imperative

<<< @/snippets/react-query/hydration.tsx#imperative

## What gets encoded

| Query state                                        | Encoded with                                       |
| -------------------------------------------------- | -------------------------------------------------- |
| success data                                       | `Codecs.success` (each page, for infinite queries) |
| a typed error                                      | `Codecs.exit`                                      |
| `RpcDefect`, `RpcTransportError`, `RpcInterrupted` | their own schemas                                  |
| pending (streamed) queries                         | the promise resolves to encoded data               |
| queries with other keys                            | passed through unchanged                           |

`dehydrate(queryClient, options)` accepts TanStack's options (`shouldDehydrateQuery`,
`serializeData`, …) plus `dehydrateErrors` (default `true`) and `keyPrefix`.

## Frameworks

Next.js and TanStack Start wire this up for you:

- Next.js: `createRscHelpers` gives `prefetch` and `HydrateClient` for server components. See
  [Next.js](../frameworks/next#rsc).
- TanStack Start: `createStartHydration` plugs into the router's SSR. See
  [TanStack Start](../frameworks/start).

::: warning Gotchas

- Use the helpers made for the same router (and the same `keyPrefix`) on both sides. Queries of
  other routers are left alone, so they reach the client as raw values.
- A dehydrated `RpcDefect` keeps its message but drops its server-side `cause`: nothing internal
  leaks into the HTML.
- With a `keyPrefix`, pass it to `createHydrationHelpers(router, { keyPrefix })`. Without it,
  prefixed queries are not dehydrated.

:::

See also: [`createHydrationHelpers`](/api/tanstack-react-query#createhydrationhelpers),
[typed errors through SSR](../advanced/ssr-errors).
