# Client middleware

Most middleware runs only on the server. Declare a middleware with `requiredForClient: true` when the
client must do something for it, such as attaching a token, signing the payload or adding a
trace header. The client half runs before the transport, over every link.

## Declare

<<< @/snippets/client/middleware.ts#declare

## Provide the client half

<<< @/snippets/client/middleware.ts#client

`middleware` is required by the types as soon as the router has a `requiredForClient` middleware.
Pass the layer from `RpcMiddleware.layerClient` (merge several with `Layer.mergeAll`).

## The server half

<<< @/snippets/client/middleware.ts#server

::: tip
For a static token, the `headers` option of `createClient` or `httpLink` is simpler. Use client
middleware when the client work depends on the request (its payload or its procedure), or when you
want the requirement enforced by the types.
:::

::: warning Gotchas

- The in-process caller needs the client half too: include it in `createCaller`'s `handlers`.
- The client half's typed `clientError` is added to the error type on the client.

:::

See also: [`MiddlewareOption`](/api/client#middlewareoption),
[server middleware](../server/middleware).
