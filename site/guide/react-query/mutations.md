# Mutations

`rpc.<path>.mutationOptions(options?)` builds the options for `useMutation`. The variables are the
procedure's input, the data is its output and the error is `ClientError<E>`, including the errors
of its middleware.

## Mutate and update the cache

<<< @/snippets/react-query/mutations.tsx#mutation

`post.create` has the `Auth` middleware, so its error type includes `Unauthorized` next to
`Forbidden`. Both arrive as instances.

After a mutation, update the cache with the typed keys (`setQueryData` with `queryKey`) or
invalidate with a filter (`pathFilter`, `queryFilter`). See [keys and filters](./keys).

## App-wide mutation behavior

<<< @/snippets/react-query/mutations.tsx#overrides

`overrides.mutations.onSuccess` wraps the `onSuccess` of every mutation built by the proxy. The
wrapper receives `{ originalFn, queryClient, meta }`. Call `originalFn()` to run the mutation's own
`onSuccess`.

::: warning Gotchas

- `mutationOptions` exists on mutations only. Calling a query imperatively from an event handler is
  `queryClient.fetchQuery(rpc.x.queryOptions(input))`, or `useRpcClient()` for a direct call.
- `mutate` swallows the rejection (TanStack reports it through `error` and `onError`).
  `mutateAsync` rethrows it as `ClientError<E>`.
- TanStack does not retry mutations by default. Keep it that way unless the mutation is idempotent.

:::

See also: [`DecorateMutationProcedure`](/api/tanstack-react-query#decoratemutationprocedure),
[`MutationOptionsOverride`](/api/tanstack-react-query#mutationoptionsoverride).
