# Serialization formats

Effect Schema decides what a value looks like as JSON. The serialization format decides how those
JSON messages are framed on the wire. Server and client must use the same one.

| `serialization`             | Framing                                     | Use when                                         |
| --------------------------- | ------------------------------------------- | ------------------------------------------------ |
| `"ndjson"` (default)        | newline-delimited JSON, streamed            | always, unless you have a reason not to          |
| `"json"`                    | one JSON array per response                 | a proxy or platform that cannot stream responses |
| an `RpcSerialization` layer | whatever the layer implements (JSON-RPC, …) | interop with other `effect/rpc` peers            |

<<< @/snippets/server/serialization.ts#match

<<< @/snippets/server/serialization.ts#custom

::: warning Gotchas

- Subscriptions over HTTP need `"ndjson"`: with `"json"` the response is sent when the stream
  ends, so values arrive all at once.
- A mismatch is not reported as a configuration error: calls fail with infrastructure errors.
  Set the option in one module that both sides import.
- A raw `effect/rpc` client talking to an effect-trpc server needs `RpcSerialization.layerNdjson`.

:::

See also: [`Serialization`](/api/server#serialization),
[`serializationLayer`](/api/server#serializationlayer).
