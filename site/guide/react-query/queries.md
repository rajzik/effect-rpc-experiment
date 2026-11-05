# Queries

`rpc.<path>.queryOptions(input, options?)` builds the options for `useQuery`, `useSuspenseQuery`,
`useQueries`, `prefetchQuery`, `ensureQueryData` and every other TanStack API that takes query
options.

## Typed data and errors

<<< @/snippets/react-query/queries.tsx#query

`data` is decoded with the procedure's schema, so it is a `Post` instance. `error` is
`ClientError<PostNotFound>`, so the `switch` narrows to your error classes.

## Options

<<< @/snippets/react-query/queries.tsx#options

`queryOptions` accepts every `useQuery` option. It adds one of its own: `rpc: { headers }`, sent
with that request. The result also carries `rpc.path` (`"post.byId"`), for devtools and logging.

## Disabling a query

<<< @/snippets/react-query/queries.tsx#skip

Pass `skipToken` as the input to keep a query idle in a type-safe way. `enabled: false` also works,
but then the input must still be valid.

## Suspense

<<< @/snippets/react-query/queries.tsx#suspense

Options built without `skipToken` work with `useSuspenseQuery` and `useSuspenseQueries`.

## Cancellation

The query's abort signal is always passed to the call. When the last observer of a running query
unmounts, TanStack cancels it, and the server handler is interrupted.

::: warning Gotchas

- `skipToken` and `useSuspenseQuery` don't mix: TanStack rejects a skipped suspense query.
- `error` is `null` (not `undefined`) when there is none, as in TanStack Query.
- Streamed query results (an async iterable returned by a query) are not supported. Use a
  [subscription](./subscriptions).

:::

See also: [`DecorateQueryProcedure`](/api/tanstack-react-query#decoratequeryprocedure),
[keys and filters](./keys).
