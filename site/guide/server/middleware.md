# Middleware and context

Middleware is `effect/rpc`'s `RpcMiddleware`. `Middleware.make` in `@effect-trpc/server` is an alias
of `RpcMiddleware.Service`, so either works. A middleware wraps the handler's Effect. It can:

- fail with a typed `error`, which is added to every procedure it is attached to;
- `provides` services to handlers (the session, the tenant, a transaction);
- read the request: `headers`, `payload`, `rpc`, `requestId`, `client`.

This is how tRPC's `ctx` maps to Effect: instead of a context object, handlers `yield*` the services
middleware provides, and the types prove they are provided.

## Declare

<<< @/snippets/server/middleware.ts#declare

Declare middleware where the router is declared: the client needs the class to know the error type.
Put the implementation on the server.

## Attach

<<< @/snippets/server/middleware.ts#attach

Attach per procedure with `.middleware(M)`, or per router with `router.middleware(M)`. Middleware
added later wraps the middleware added before it, so it runs first.

## Implement

<<< @/snippets/server/middleware.ts#implement

The implementation is a `Layer` of the middleware service. Like handler layers, it can depend on
services (here `Sessions`), which stay requirements until you provide them.

## Use the context in handlers

<<< @/snippets/server/middleware.ts#handlers

`Session` is not a requirement of `HandlersLive`: the middleware provides it, and the types know.
A handler under `public` that tried to `yield* Session` would leave `Session` as a requirement,
which the adapter rejects at compile time.

## Call it

<<< @/snippets/server/middleware.ts#call

The `Unauthorized` rejection is typed: `account.me`'s error type is `Unauthorized`.

## Metadata with `.annotate`

tRPC's `meta` is `.annotate(Key, value)`. It stores a value on the procedure, and a middleware reads
it from `rpc.annotations` to decide what to do for that procedure.

<<< @/snippets/server/meta.ts#declare

<<< @/snippets/server/meta.ts#annotate

<<< @/snippets/server/meta.ts#implement

<<< @/snippets/server/meta.ts#call

- The key is an ordinary `Context.Key`, so the value is typed per key. A `Context.Reference`, as
  above, gives procedures that don't set it a default; for a plain key read it with
  `Context.getOption`.
- `.annotate` is on `query`, `mutation` and `subscription` definitions and on the `Procedure`
  builder, at any step. It returns a new definition of the same type, and annotating a key again
  replaces its value.
- Annotations are runtime metadata of the server's rpc. They are not sent over the wire, and
  `ProcedureKind` always wins: annotating that key does not change a procedure's kind.
- There is no router-level `.annotate`: annotate the procedures.
- [Codegen](../advanced/codegen) accepts a trailing `.annotate`. The generated client contract
  (`router.client.gen.ts`) omits annotations and keeps middleware; `router.gen.ts` keeps both.

## Client-side middleware

A middleware declared with `requiredForClient: true` also runs in the client, before the transport,
for example to sign requests. See [client middleware](../client/middleware).

::: warning Gotchas

- Provide every middleware implementation with the handlers:
  `Layer.mergeAll(HandlersLive, AuthLive)`. Forgetting one is a compile error at the adapter.
- `headers` holds the HTTP request headers merged with the rpc message headers. Over a WebSocket
  there is one HTTP request per connection, so per-call `headers` are what changes between calls.
- Middleware errors are typed errors: they reach the client as instances, not as defects.

:::

See also: [`Middleware`](/api/server#middleware), [Authentication recipe](../advanced/auth).
