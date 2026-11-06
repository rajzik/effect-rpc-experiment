# Routers as services

[Routers and procedures](./routers) declares the schemas in one place and the handlers in another
(`Handlers.make`). There is a second style: write the router **once**, as an ordinary Effect
service whose procedures carry their own handlers. Both styles produce the same wire format, work
with every adapter and can be mixed.

## The service form

<<< @/snippets/concepts/router-service.ts#service

- `Context.Service<AppRouter>()('AppRouter', { make })` is the service constructor you already use.
  `make` returns a record of procedures. It nests to any depth, and `as const` is not needed.
- `Procedure` is a builder. Every step is optional except the last: `input` (struct fields or a
  schema), `output`, `error`, `middleware`, and then `query`, `mutation` or `subscription` with the
  handler. The defaults match `query({...})`: no input, `Void` output, `Schema.Never` error.
- The handler is typed from the earlier steps. Its payload is the decoded input, it must succeed with
  the decoded output and it may fail only with the declared error (plus the errors of middleware
  added before the terminal). A subscription handler returns a `Stream`.
- Services are read inside the handler with `yield*`. Their types become requirements of the
  implementation, inferred: nothing is declared by hand.

Wire format, tags and every client are the same as for the equivalent `query({...})` router. The
class works as the router everywhere: `createClient(AppRouter, …)`, `createCaller`,
`toWebHandler`, `serve`, the TanStack Query, Next.js, TanStack Start and Electron adapters, the
test harness, and `inferRouterInputs<typeof AppRouter>`.

## `make` must not read services

`make` is an `Effect` **value** with no requirements and no failure: `Effect<Record, never, never>`.
Services belong inside the handlers, as in the example above. A `make` that needs a service is a
compile error at every entry point.

The reason is the client. A client has no server layers, yet it needs the runtime schemas to decode
a `Post` instance or a `PostNotFound` error. So every API, client and server, evaluates `make`
synchronously (once per class per process, memoized) to get the procedures. That evaluation must not
need a database, a config or a clock service to succeed.

- One-time setup (opening a connection, reading config) belongs in the service's own layer, for
  example `DatabaseLive`. The handler reads the ready service per call.
- If you force a `make` that needs a service, fails or is asynchronous (a cast, `Effect.sleep`), the
  first use throws an error that names the service and the rule instead of hanging:
  `Cannot build a router from the router service "AppRouter": make must not require services or be asynchronous, and must not fail (read services inside the procedure handlers instead)`.

## Implement and serve it

<<< @/snippets/concepts/router-service.ts#handlers

`Handlers.fromService(AppRouter)` builds the server implementation from the procedures' own
handlers. The layer's requirements are the union of what the handlers read: `Database` here. They
exclude `Scope` and the services a procedure's middleware provides, so a handler may `yield*` a
`CurrentUser` that `Auth` provides without it becoming a requirement.

The layer also provides the class itself: `yield* AppRouter` returns exactly the record `make`
produced (`Router.serviceValue(AppRouter)`, from the same single evaluation), so a router service
nested in it is the class, as its type says.

Every adapter takes the class and the layer, exactly as it takes a router and `Handlers.make`:

<<< @/snippets/concepts/router-service.ts#serve

A client imports the same module and passes the same class:

<<< @/snippets/concepts/router-service.ts#client

`createClient(AppRouter, …)` has the types of the equivalent `Router.make` router. The decoded
`Post` instance, its getters and `PostNotFound` come from the schemas in `make`, not from plain JSON.

## Nesting and mixing

<<< @/snippets/concepts/router-service-nesting.ts#nesting

A service can nest inside another service's `make`, inside a plain `Router.make` record, or inside a
plain record at any depth, and a router can nest inside a service. `Router.make` resolves the
service to a router, memoized, so the same class is the same router everywhere. Tags are the
dot-joined paths, as ever.

`Router.from(x)` turns a router or a service class into a router (a router comes back unchanged).
`Router.fromService(AppRouter)` is the service-only form and `Router.isService(u)` is the guard.
`Router.Of<typeof AppRouter>` is the router type of a class, and is the one to use in type
positions.

### Mixing with `query({...})`

`query`, `mutation` and `subscription` definitions have no handler. They are fine in a router (or in
a service's `make`), but `Handlers.fromService` and `Handlers.fromProcedures` reject them: at
compile time with a property named `procedure 'health' has no handler …`, or with an error naming
every path if you force it. Implement a mixed router with `Handlers.make` and reuse the handlers a
builder procedure carries:

<<< @/snippets/concepts/router-service-nesting.ts#mixed

`Handlers.fromProcedures(router)` is the same as `fromService` for a plain `Router.make` router
whose procedures all come from the builder. It does not provide a service.

## Middleware

<<< @/snippets/concepts/router-service-middleware.ts#middleware

Middleware attaches in the builder (before the terminal: the handler may fail with its errors) or
on a finished procedure (`procedure.middleware(Auth)`). Both keep the handler. Middleware added
after the terminal does not widen the handler's own error type. Its implementation is a separate
layer, merged with the handlers as in [Middleware and context](../server/middleware).

For a group of procedures, nest a router with `.middleware(Auth)` inside the `make` record. Its
handlers are kept, and the services `Auth` provides are not requirements of the layer:

<<< @/snippets/concepts/router-service-middleware.ts#group

`make` itself must succeed with a record, not a router: a `make` of
`Effect.succeed(Router.make({...}).middleware(Auth))` is a compile error at every entry point, and
an error naming the service if forced with a cast. `Router.from(AppRouter).middleware(Auth)` is
allowed, but it returns a new plain router, not the service: serve it with
`Handlers.fromProcedures(router)` and give clients that same router.

## React, Next.js and TanStack Start

Adapter functions take the class directly: `createClient(AppRouter, …)`,
`createRouteHandler(AppRouter, …)`, `createNextRpcClient(AppRouter)`, `createStartHandler(AppRouter, …)`,
`createIsomorphicClient(AppRouter, …)`, `createHydrationHelpers(AppRouter, …)` and the rest.

Types that take a router **type** take `Router.Of<typeof AppRouter>`, not the class:
`Client<Router.Of<typeof AppRouter>>`, `Caller<…>`, `NextRpcClient<…>`, `StartHelpers<…>`. For
`createRpcContext`, the class type works because it maps it for you:

<<< @/snippets/concepts/router-service-react.tsx#react

## The quick start router as a service

The router from the [quick start](../quick-start), written in this style, is in
[Or write it as a service](../quick-start#or-write-it-as-a-service).

::: warning Gotchas

- Handler code ships to the browser. The client imports the module that holds `make`, so the
  handlers are in the client bundle. That is logic, not secrets: services are interfaces and the
  live layers (`DatabaseLive`, API keys) stay on the server. Keep anything secret out of the
  handler body and out of the module's imports. A build step that strips handlers is not part of
  effect-trpc yet. If the handlers must not ship at all, use `Router.make` with `query({...})` and
  keep `Handlers.make` in a server-only module.
- `make` runs once per class. A subclass (`class B extends AppRouter {}`) gets its own evaluation. A
  `make` that fails is not cached.
- A second `.input`, `.output` or `.error` call replaces the earlier schema. `.middleware`
  accumulates.
- Providing the layer is still required. `Handlers.fromService(AppRouter)` alone is not a complete
  server: provide its requirements (`Layer.provide(DatabaseLive)`) and merge the middleware layers.
- `Client<typeof AppRouter>` is a type error: write `Client<Router.Of<typeof AppRouter>>`.
- An async `make` is a runtime error, a `make` that needs services is a compile error. Both name the
  rule above.

:::

See also: [`Procedure`](/api/core#procedure), [`Router.from`](/api/core#router-from),
[`Router.fromService`](/api/core#router-fromservice), [`Router.isService`](/api/core#router-isservice),
[`Handlers.fromService`](/api/server#handlers-fromservice),
[`Handlers.fromProcedures`](/api/server#handlers-fromprocedures).
