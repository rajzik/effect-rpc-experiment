# Headers, cancellation and options

Every Promise call takes `{ signal?, headers? }` as its second argument. Effect calls take
`{ headers? }` and are cancelled by interruption.

## Headers

<<< @/snippets/client/call-options.ts#headers

Client headers are merged in this order, the later one winning on the same name:

1. `createClient({ headers })`
2. `client.withHeaders(headers)` (stackable)
3. the call's `{ headers }`

They travel with the rpc message, so they reach server middleware and handlers over every link,
including `localLink` and `wsLink`. `httpLink({ headers })` sets HTTP request headers instead
(useful for proxies and gateways). The server sees both, merged; avoid setting the same name in
both places.

## Cancellation and timeouts

<<< @/snippets/client/call-options.ts#abort

Aborting interrupts the server handler, not just the client's wait: the handler's finalizers run.
The rejection is `RpcInterrupted`.

::: warning Gotchas

- A header function is evaluated once per call. Do not do expensive work in it without caching.
- Header names are case-insensitive and arrive lower-cased: read `headers['x-tenant']`, not
  `headers['X-Tenant']`.
- `client.dispose()` interrupts in-flight calls; they reject with `RpcInterrupted`.

:::

See also: [`ProcedureCallOptions`](/api/client#procedurecalloptions),
[`HeadersOption`](/api/client#headersoption),
[Cancellation and timeouts](../advanced/cancellation).
