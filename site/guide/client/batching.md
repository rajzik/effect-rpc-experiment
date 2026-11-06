# Batching

`httpBatchLink` is `httpLink` that sends the queries called in the same tick as one POST (tRPC's
`httpBatchLink`). Use it when a page fires many queries at once, for example several `useQuery`
hooks, and one request per query is too many.

<<< @/snippets/client/batching.ts#batch

It takes the options of `httpLink` plus `maxItems`, the maximum number of calls in one POST (a
positive integer; default: no limit). The server needs nothing: every HTTP adapter already accepts
several requests in one body and streams the responses back by request id. With the default
`ndjson` each call settles as soon as its own result arrives, not when the slowest one does.

## What is batched

- Queries called before a `setTimeout(0)` scheduled by the first queued query share a POST. With
  `maxItems` the batch is split into POSTs of at most that many calls.
- Mutations and subscriptions are not batched: each gets its own POST, as with `httpLink`.
- Rpc headers (`createClient({ headers })`, `withHeaders`, per-call `headers`) travel with each
  call, so calls with different headers still share a POST.
- The `headers` option of the link is a function evaluated once per POST.

## Errors and cancellation

- A typed failure or a defect fails only its own call, as always.
- A non-2xx response or a network error fails every call of the POST with `RpcTransportError`.
- Aborting a call (`signal`, fiber interruption) rejects it at once with `RpcInterrupted`; the POST
  goes on for the other calls. Once no call of the POST is left waiting, a POST that had an aborted
  call is aborted, so aborting every call aborts it at once. The server keeps running an aborted
  call until then: its handler is interrupted when the POST is, not at the abort.

::: warning Gotchas

- The calls of a batch share one HTTP response. Headers and cookies that a handler sets
  ([`HttpContext`](../server/http-context)) apply to all of them, and only if set before the first
  response chunk is written, which is the fastest call finishing. Keep a `login` mutation, which is
  never batched, for cookies.
- With `serialization: 'json'` the server answers when every call of the POST has finished, so one
  slow query holds back the others. Keep the default `"ndjson"`.
- Only queries are batched. tRPC also batches mutations.
- The URL must be absolute `http:` or `https:`, and `maxItems` a positive integer. Otherwise the
  link throws when it is created.
- There is no URL-length limit to work around, so tRPC's `maxURLLength` has no equivalent: calls
  travel in the POST body.

:::

See also: [Links](./links), [`httpBatchLink`](/api/client#httpbatchlink).
