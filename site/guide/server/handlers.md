# Handlers

`Handlers.make(router, record)` implements a router. It returns a `Layer`, the same layer
`router.group.toLayer(...)` from `effect/rpc` produces, so it works with every adapter and with
`effect/rpc` directly.

## A record that mirrors the router

<<< @/snippets/server/handlers.ts#service

<<< @/snippets/server/handlers.ts#record

- A query or mutation handler returns an `Effect`. A subscription handler returns a `Stream` (or an
  `Effect` of a `Queue.Dequeue`).
- The handler's error must be one of the procedure's declared errors (or middleware errors).
  Anything else is a type error. A thrown exception or `Effect.die` becomes `RpcDefect` on the client.
- Return the declared success type. Returning a `Post` instance for a `Post` schema is enough: it is
  encoded on the way out.

## The second argument: request context

| `ctx` field | What                                                                          |
| ----------- | ----------------------------------------------------------------------------- |
| `headers`   | HTTP request headers merged with the rpc message headers (per-call `headers`) |
| `requestId` | the rpc request id                                                            |
| `rpc`       | the compiled rpc (its tag, schemas, annotations)                              |
| `client`    | the `effect/rpc` client connection                                            |

For anything derived from the request (the user, the tenant), prefer middleware that `provides` a
service over reading headers in every handler. See [middleware](./middleware).

## Services: per call, or once when the layer is built

Services a handler `yield*`s stay requirements of the layer. Provide them before the layer reaches
an adapter:

<<< @/snippets/server/handlers.ts#provide

To resolve services once, when the layer is built, pass an `Effect` that produces the record.
Wrap the record in `Handlers.of(router, …)` to keep the handler parameters typed:

<<< @/snippets/server/handlers.ts#build

## The flat form

`Handlers.flat` takes tag-keyed handlers, as `effect/rpc` does:

<<< @/snippets/server/handlers.ts#flat

## Types

| Type                       | What                                                            |
| -------------------------- | --------------------------------------------------------------- |
| `Handlers.From<R>`         | the nested record `Handlers.make` takes                         |
| `Handlers.Flat<R>`         | the tag-keyed record `Handlers.flat` takes                      |
| `Handlers.Requirements<R>` | everything a server layer must provide: handlers and middleware |

::: warning Gotchas

- A missing handler is a compile error at `Handlers.make`. A missing middleware implementation is a
  compile error at the adapter (`toWebHandler`, `createCaller`, `serve`): merge it in with
  `Layer.mergeAll(HandlersLive, AuthLive)`.
- `Scope` and services provided by middleware are not requirements of the handler layer. Everything
  else is.
- The layer is built once per server (or caller) and shared by every request. Per-request state
  belongs in middleware or in the handler, not in the build effect.

:::

See also: [`Handlers`](/api/server#handlers), [`Handlers.make`](/api/server#handlers-make).
