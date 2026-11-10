# Links

A link is the client's transport. It turns the router's `RpcGroup` into a connected `effect/rpc`
`RpcClient`. Swapping the link changes how calls travel and nothing else: the client API and its
types stay the same.

| Link                                                                 | Transport                                             | Server side                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------ |
| `httpLink({ url, headers?, fetch?, serialization? })`                | one POST per call; streams are NDJSON                 | `toWebHandler`, `serve`, `layerHttp`             |
| `httpBatchLink({ …httpLink options, maxItems? })`                    | same-tick queries in one POST: [batching](./batching) | as `httpLink`                                    |
| `wsLink({ url, serialization?, retryTransientErrors?, WebSocket? })` | one multiplexed WebSocket                             | `layerHttp(..., { protocol: 'websocket' })`      |
| `localLink({ handlers })`                                            | in-process, no serialization                          | none: runs the handler layer                     |
| `messagePortLink`, `rendererLink`                                    | Electron `MessagePort`                                | [`@rpc-effect/electron`](../frameworks/electron) |
| `Link.make(...)`, `Link.fromProtocol(...)`                           | anything: see [custom links](../advanced/custom-link) | —                                                |

## HTTP

<<< @/snippets/client/links.ts#http

`headers` can be a function, evaluated once per request (tRPC's `headers()` option). If it throws
or rejects, the call fails with `RpcTransportError`.

## WebSocket

<<< @/snippets/client/links.ts#ws

`retryTransientErrors: true` reconnects on transient socket errors instead of failing in-flight
calls. `WebSocket` lets you pass an implementation where `globalThis.WebSocket` is missing.

## In-process

<<< @/snippets/client/links.ts#local

Use it in tests, scripts and SSR. It runs the real handlers and middleware, so tests cover the same
code paths as production, without serialization.

## Through a fetch handler

<<< @/snippets/client/links.ts#fetch

`fetch` replaces the global `fetch`: a test double, a polyfill, or a web handler as here. This path
does serialize, so it is the closest you get to the network without a port.

::: warning Gotchas

- URLs must be absolute, for both `httpLink` and `wsLink`.
- `serialization` must match the server. The default (`"ndjson"`) matches the default server.
- A `localLink` whose layer does not implement every procedure (and middleware) of the router is a
  compile error at `createClient`.
- `httpLink` sends each call as its own request. Use [`httpBatchLink`](./batching) to batch the
  queries of one tick, or `wsLink` to share one connection.

:::

See also: [`httpLink`](/api/client#httplink), [`wsLink`](/api/client#wslink),
[`localLink`](/api/client#locallink), [`Link`](/api/client#link).
