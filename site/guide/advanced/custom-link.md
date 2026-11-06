# Writing a custom link

A link builds the `effect/rpc` `RpcClient` a client uses. Write one when the built-in links don't fit:
a custom `HttpClient` (retries, proxies, signing), a different transport (a worker, a message bus),
or instrumentation.

## From a protocol

`Link.fromProtocol(layer)` takes any `RpcClient.Protocol` layer. This is how `httpLink` and `wsLink`
are built.

<<< @/snippets/advanced/custom-link.ts#protocol

## From scratch

`Link.make(makeClient)` gives full control: `makeClient(group)` returns an Effect of an `RpcClient`
for any group. It runs once per client, lazily, in the client's scope.

<<< @/snippets/advanced/custom-link.ts#make

## Rules

- The link must work for any `RpcGroup`: it receives the router's group at runtime.
- Resources must be scoped (`Effect.acquireRelease`, layers): `client.dispose()` closes the scope.
- Serialization must match the server (`RpcSerialization.layerNdjson` by default).
- Errors while building become defects (`RpcDefect`). Transport failures during calls should be
  `RpcClientError`s, which the client reports as `RpcTransportError`.

See also: [`Link`](/api/client#link), [`Link.make`](/api/client#link-make),
[`Link.fromProtocol`](/api/client#link-fromprotocol), [links](../client/links).
