# Routers as services

[Routers and procedures](./routers) declares the schemas in one place and the handlers in another
(`Handlers.make`). There is a second style: write the router **once**, as an ordinary Effect
service whose procedures carry their own handlers. Both styles produce the same wire format, work
with every adapter and can be mixed.

## The service form

<<< @/snippets/concepts/router-service.ts#service [router.ts]

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

Wire format, tags and every client are the same as for the equivalent `query({...})` router. While
`make` reads no services, as here, the class works as the router everywhere: `createClient(AppRouter, …)`,
`createCaller`, `toWebHandler`, `serve`, the TanStack Query, Next.js, TanStack Start and Electron
adapters, the test harness, and `inferRouterInputs<typeof AppRouter>`. A `make` that reads
services is [served differently](#make-that-reads-services).

## `make` that reads services

`make` is an `Effect` value. When it needs nothing (`Effect<Record, never, never>`), every API can
run it, as above. It may also read services and fail, so that config can shape the handlers and a
service is read once instead of in every handler:

<<< @/snippets/concepts/router-service-effectful.ts#service [router.ts]

Such a router (an _effectful_ router service) is served by the class and used everywhere else
through a **contract**, because only the server has the services:

- `Handlers.fromService(AppRouter)` takes the class. `make` runs inside the layer, with the real
  services, once per layer build. The layer's error is the error of `make` and its requirements are
  what `make` reads plus what the handlers read, so you provide `AppConfig` and `Database` once.
- Everything that needs the router synchronously takes the contract instead: `createClient`,
  `toWebHandler`, `serve`, `createCaller`, the framework adapters and the test harness. A client has
  no server layers, yet it needs the runtime schemas to decode a `Post` or a `PostNotFound`.
- The contract is a schema-only `Router.make` router with the same tags, schemas and middleware, and
  no handlers. It is normally the `router.client.gen.ts` that
  [`@rpc-effect/codegen`](../advanced/codegen) writes from the class (it reads `Effect.gen` makes),
  with a compile-time check that it still matches the class.
- If you write the contract by hand, add that check yourself (below). The server serves the
  contract's procedures, middleware included: a contract that misses `.middleware(Auth)` serves the
  procedure without `Auth`, and no type asks for `AuthLive`.

<<< @/snippets/concepts/router-service-effectful.ts#contract [contract.ts]

<<< @/snippets/concepts/router-service-effectful.ts#server [server.ts]

<<< @/snippets/concepts/router-service-effectful.ts#client [client.ts]

- Passing the class to one of those APIs is a compile error. If you force it with a cast, it throws
  `Cannot build a router from the router service "AppRouter": make must be synchronous, read no services and not fail: give this API the contract (router.client.gen.ts) and serve the class with Handlers.fromService`.
- Router services nest inside an effectful service's `make`, pure or effectful, at any depth. Their
  `make` effects run in the same layer, and their errors and requirements join the layer's. An
  effectful service cannot nest in a plain `Router.make({...})` record (a compile error).
- `yield* AppRouter` returns the record that build's `make` produced.
- `Router.buildService(AppRouter)` is the same build as an `Effect`, if you provide the services
  yourself.
- `make` must still produce its schemas without a service: a schema that uses a value read in
  `make` cannot exist on the client, and codegen reports it.
- A pure `make` is still the simplest: one-time setup (opening a connection) can live in the
  service's own layer, with the handler reading the ready service per call.

### With inferred schemas

`.output` and `.error` can be left out here too ([inferred schemas](#inferred-schemas-experimental)).
The handlers close over what `make` read, and their types come from those services:

<<< @/snippets/concepts/router-service-effectful-inferred.ts#written [router.ts]

Codegen writes the same two modules as for a pure router. `router.gen.ts` is a lazy router service
(nothing runs at import): serve it with `Handlers.fromService`. `router.client.gen.ts` is the
contract for the client and every synchronous API:

<<< @/snippets/concepts/router-service-effectful-inferred.gen.ts#generated [router.gen.ts]

<<< @/snippets/concepts/router-service-effectful-inferred.gen.ts#server [server.ts]

<<< @/snippets/concepts/router-service-effectful-inferred.client.gen.ts#client [router.client.gen.ts]

## Implement and serve it

<<< @/snippets/concepts/router-service-server.ts#handlers [server.ts]

`Handlers.fromService(AppRouter)` builds the server implementation from the procedures' own
handlers. The layer's requirements are the union of what the handlers read: `Database` here. They
exclude `Scope` and the services a procedure's middleware provides, so a handler may `yield*` a
`CurrentUser` that `Auth` provides without it becoming a requirement.

The layer also provides the class itself: `yield* AppRouter` returns exactly the record `make`
produced, so a router service nested in it is the class, as its type says.

Every adapter takes the class and the layer, exactly as it takes a router and `Handlers.make`:

<<< @/snippets/concepts/router-service-server.ts#serve [server.ts]

A client imports the router module (never the server module) and passes the same class:

<<< @/snippets/concepts/router-service-client.ts#client [client.ts]

`createClient(AppRouter, …)` has the types of the equivalent `Router.make` router. The decoded
`Post` instance, its getters and `PostNotFound` come from the schemas in `make`, not from plain JSON.

## Nesting and mixing

<<< @/snippets/concepts/router-service-nesting.ts#nesting

A service can nest inside another service's `make`, or (a pure one) inside a plain `Router.make`
record or a plain record at any depth, and a router can nest inside a service. `Router.make` resolves the
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

## Inferred schemas (experimental)

Leave out `.output(...)` and `.error(...)` and the types come from the handler. Without
`.output` the handler may return anything; without `.error` it may also fail with anything:

<<< @/snippets/concepts/router-service-inferred.ts#written [router.ts]

Types alone don't put a `Post` on the wire: the server needs a schema to encode it and the client
one to decode it. [`@rpc-effect/codegen`](../advanced/codegen) reads each handler's inferred
`Effect<A, E>` with the TypeScript 7 checker and writes two modules next to the router:

<<< @/snippets/concepts/router-service-inferred.gen.ts#generated [router.gen.ts]

<<< @/snippets/concepts/router-service-inferred.client.gen.ts#client [router.client.gen.ts]

- Schema classes (`Post`, `PostNotFound`) are imported from where they are declared, so
  transformations, getters and `instanceof` work on the client. Plain object types become a
  `Schema.Struct`. A plain class or a function as output stops the generator with its location.
- Only `Schema.TaggedError`-style classes become typed errors. Anything else (a
  `Data.TaggedError`, a raw `Error`) arrives as `RpcDefect`, and the generated client types say
  so: `create` fails with `Forbidden`, not `DbError`.
- The server module wraps the router module (`Router.withSchemas`): it is imported once, its
  state is not copied. It is a router service with the same key and `make`: serve it with
  `Handlers.fromService`.
- The client module has no handlers and does not import the router module, so handler code and
  server-only imports stay out of client bundles. A compile-time check in it fails when it no
  longer matches the server router.
- A router used without the generated schemas dies with a defect that names the fix when a
  handler returns a value, and every failure reaches the client as a defect.

Run it with `effect-trpc-codegen src/router.ts` (`--watch` in dev, `--check` in CI) or the Vite
plugin: see [Schemas from handler types](../advanced/codegen).

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
  handler body and out of the module's imports. If the handlers must not ship at all, give
  clients the handler-free `router.client.gen.ts` that
  [`@rpc-effect/codegen`](../advanced/codegen) writes, or use `Router.make` with `query({...})`
  and keep `Handlers.make` in a server-only module.
- A pure `make` runs once per class for the synchronous APIs. A subclass
  (`class B extends AppRouter {}`) gets its own evaluation. A `make` that fails is not cached.
  `Handlers.fromService` runs `make` once per layer build.
- A second `.input`, `.output` or `.error` call replaces the earlier schema. `.middleware`
  accumulates.
- Providing the layer is still required. `Handlers.fromService(AppRouter)` alone is not a complete
  server: provide its requirements (`Layer.provide(DatabaseLive)`) and merge the middleware layers.
- `Client<typeof AppRouter>` is a type error: write `Client<Router.Of<typeof AppRouter>>`.
- An async `make` is a runtime error for the synchronous APIs. A `make` that needs services is a
  compile error for every API but `Handlers.fromService`, and a runtime error naming the contract if
  forced.

:::

See also: [`Procedure`](/api/core#procedure), [`Router.from`](/api/core#router-from),
[`Router.fromService`](/api/core#router-fromservice), [`Router.buildService`](/api/core#router-buildservice),
[`Router.isService`](/api/core#router-isservice),
[`Handlers.fromService`](/api/server#handlers-fromservice),
[`Handlers.fromProcedures`](/api/server#handlers-fromprocedures).
