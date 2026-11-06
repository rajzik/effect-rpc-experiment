# Routers as Effect services — design

Date: 2026-11-05 · Status: approved 2026-11-05

## Intent

Let users write a router **once**, as an ordinary Effect v4 service, with every type inferred:
procedures are built with a tRPC-style builder that carries schemas and the implementation
together, and the service's `make` returns the procedures. No `type AppRouter = typeof appRouter`,
no separate `Handlers.make`, no new class factory to learn — the same
`Context.Service<Self>()(id, { make })` Effect users already write.

```ts
// router.ts — written once, imported by server and client
export class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.succeed({
    post: {
      byId: Procedure.input({ id: Schema.Finite })
        .output(Post)
        .error(PostNotFound)
        .query(
          Effect.fn(function* ({ id }) {
            // id: number, inferred from .input
            const db = yield* Database; // services are read inside handlers
            return yield* db.findPost(id);
          }),
        ),
    },
  } as const),
}) {}

// client — types inferred from the service, schemas obtained from make
const client = createClient(AppRouter, { link: httpLink({ url }) });
const post = await client.post.byId({ id: 1 }); // Post instance; rejects with PostNotFound

// server — handler requirements inferred (Database)
const { handler } = await toWebHandler(AppRouter, {
  handlers: Handlers.fromService(AppRouter).pipe(Layer.provide(DatabaseLive)),
});
```

## Decisions from the conversation

- The router must be written **only once**. Schemas may live anywhere (inline or imported from a
  shared module) and are inferred.
- Use a **plain Effect `Context.Service`** whose `make` returns the procedures — no
  `RouterService` factory.
- Procedures carry schemas **and** implementation (builder, tRPC style).
- **Client types are always inferred** from the service (`typeof AppRouter`).
- Clients must keep **runtime schemas** (decoded `Schema.Class` instances, typed error classes), so
  the client obtains the procedures by evaluating `make`.

## Goals

1. **`Procedure` builder** (`@effect-trpc/core`): `Procedure.input(fields | schema)`,
   `.output(schema)`, `.error(schema)`, `.middleware(M)`, terminal `.query(handler)`,
   `.mutation(handler)`, `.subscription(handler)` (handler returns `Stream`). Each step is
   optional except the terminal; defaults match today's `query({...})` (`Void`, `Void`, `Never`).
   The handler is contextually typed from the earlier steps: payload type from `input`, return type
   checked against `output`, failures checked against `error` + middleware errors. The handler's
   requirements `R` are recorded in the procedure's type.
2. **Router from a service:** a service class whose `make` produces a record of procedures (nested
   records allowed) is accepted **everywhere a router is accepted today**: `createClient`,
   `createCaller`, `toWebHandler`, `layerHttp`, `serve` / `runServer`, `localLink`,
   `createRpcOptionsProxy` / `createRpcContext`, hydration helpers, Next.js (`createRouteHandler`,
   `createNextRpcClient`, `createRscHelpers`, `createServerActionCaller`), TanStack Start
   (`createStartHandler`, `createIsomorphicClient`, `createStartHelpers`), Electron
   (`MainRpcServer`, `rendererLink`), test-utils, and the type helpers (`inferRouterInputs` etc.,
   `Router.Paths`). One internal normalizer turns "router or router-service" into a `Router`; no
   adapter gets a special case.
3. **Implementations from the procedures:** `Handlers.fromService(AppRouter)` (server) returns the
   rpc handler layer built from the procedures' own handlers, with `R` = the union of every
   handler's requirements (minus `Scope` and middleware-provided services), inferred. Adapters that
   take `handlers` accept it directly.
4. **One rule, enforced by types everywhere:** a router service's `make` must have no
   requirements and no failure (`Effect<Record, never, never>`): services are read inside handlers,
   never at the top of `make`. Every API (client and server) evaluates `make` synchronously
   (`Effect.runSync`, memoized per class) to get the procedures, so all adapters stay synchronous
   exactly as today. A service whose `make` needs services is a compile error at every entry point
   (and a clear runtime error if forced). This is what keeps "client types and schemas always
   available" true for every router service.
5. Mixing: a service's procedures and today's `ProcedureDef`s + routers can be nested in each other;
   `Router.make({ admin: AdminRouter, health: query({...}) })` works, and so does the reverse.

## Non-goals

- Removing `query({...})` / `Router.make` / `Handlers.make`: they stay; the builder + service form is
  an additional style with docs showing both.
- Stripping handler code from browser bundles (a later build plugin could).
- A `RouterService` class factory (explicitly declined).

## Anti-goals

- Writing the router twice (schemas in one place, implementations in another) in the new style.
- Untyped handler parameters or hand-written requirement types.
- A client silently getting plain JSON instead of class instances.
- Breaking any existing API or test.

## Constraints

- Effect v4: `Context.Service<Self>()(id, { make })` infers the shape from `make` and exposes static
  `make` (`effect/dist/Context.d.ts`, `Service` overloads). Verify every API against the d.ts.
- Package boundaries: `Procedure` and the normalizer live in `@effect-trpc/core` (no dependency on
  server); `Handlers.fromService` in `@effect-trpc/server`.
- A procedure value now holds a handler (a closure). Today's `ProcedureDef` is schema-only and the
  wire tag/compile path (`compileDef`, `Router.make`) must stay unchanged for existing users.
- Repo conventions (AGENTS.md): Effect-style JSDoc with compiling examples, `.test-d.ts` for every
  typed claim, README `## For AI agents`, `test/PARITY.md`, `pnpm check` with `--deny-warnings`.

## Approaches considered

| Approach                                                                                           | Trade-off                                                                                                      | Outcome    |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------- |
| `RouterService` factory with `procedures` + `make` building handlers                               | Server code in client bundle; `Effect.gen` gives no contextual typing without a helper                         | Rejected   |
| Router built inside `make` that reads services at top level                                        | Client can't run `make` → no runtime schemas                                                                   | Rejected   |
| **Plain `Context.Service` whose `make` returns builder procedures; services read inside handlers** | Handler bodies ship to the browser (logic, not secrets: services are interfaces, live layers stay server-only) | **Picked** |

## Design

### `Procedure` builder (core)

- Immutable builder; each method returns a new builder with refined type parameters
  `<Kind, P, S, E, M>`. Terminals produce a `Procedure` value: the existing `ProcedureDef` data
  (kind, payload, success, error, middleware) **plus** `handler` (type
  `(payload, ctx) => Effect<A, E | MiddlewareErr, R>` or `Stream` for subscriptions).
- `Procedure` is a `ProcedureDef` for every existing consumer (compile, codecs, inference helpers,
  proxies) — adding a field, not changing the shape.
- `input(fields)` accepts struct fields or a schema, like `query({ payload })` today.

### Router from a service (core)

- `Router.isService(u)`: a `Context.Service` class whose static `make` is an `Effect` (or a function
  returning one is out of scope: v1 requires a value `make`).
- `Router.fromService(Svc)`: evaluates `Svc.make` with `Effect.runSync` (client path; compile error
  unless `R = never`, runtime throws a clear error if it fails or is async), then `Router.make(result)`.
  Memoized per class.
- Internal `toRouter(routerOrService)` used by every adapter entry point; public types:
  `Router.Input = Router.Any | RouterService.Any` and `Router.Of<X>` mapping either to the router
  type, so `inferRouterInputs<typeof AppRouter>` works.
- There is no separate server path: server adapters use the same memoized `Router.fromService`,
  so `make` runs once per process regardless of how many adapters use the class.

### Implementations (server)

- `Handlers.fromService(Svc)`: `Layer` providing every rpc handler from the procedures' `handler`s
  (nested paths → tags exactly as `Router.make` does), plus the `Svc` service itself. Requirements
  inferred: the union of handler `R`s and `make`'s `R`.
- `Handlers.fromProcedures(router)`: same for a plain router whose procedures were built with the
  builder (handlers present) — so `Router.make({ byId: Procedure...query(...) })` also works
  without a service.
- A procedure without a handler (legacy `query({...})`) inside a service is a compile error for
  `Handlers.fromService`; mixing requires `Handlers.make` for those paths (documented).

### Types and tests

- `.test-d.ts`: handler param inference from `input`; wrong return / undeclared error rejected;
  requirements inferred on `Handlers.fromService`; client error unions equal those of the equivalent
  `query({...})` router; `createClient` rejects a service whose `make` needs services; every adapter
  accepts the service class (one type test per package).
- Runtime: end-to-end through caller, web handler + `httpLink` (class instances and typed errors
  decoded on the client), `localLink`, React Query proxy, one framework adapter per package;
  `make` evaluated once per process (memoization) even when the client, `Handlers.fromService` and a
  server adapter all use the class; a `make` that reads a service is a compile error at
  `createClient`, `toWebHandler` and `Handlers.fromService`.
- Docs: core/server READMEs + JSDoc; docs site page "Routers as services" (Core concepts) and the
  quick start showing the new style next to the existing one; examples untouched (my call).

### Middleware (my call)

Middleware may be added with the builder's `.middleware(M)` before the terminal, on the finished
procedure, or at router level (`router.middleware(M)`). Every path keeps the handler: applying
middleware copies the procedure including `handler`, and the type helpers (`ProcedureDef.AddMiddleware`,
`Router.WithMiddleware`) carry the handler's type parameters through. `Handlers.fromService`
computes requirements from the final procedure: handler `R` minus `Scope` and the services the
procedure's middleware provides (as `Handlers.make` does today).

### Nesting and mixing (my call)

A router service may appear anywhere a router may: inside `Router.make({ admin: AdminRouter })` and
inside another service's `make` record. `Router.make` and the normalizer resolve a nested service
through the memoized `Router.fromService` (a synchronous `runSync` of an `Effect` with no
requirements, so no meaningful module-load side effect), and `router.record` holds the resolved
router for that entry, so `inferRouterInputs`, `Router.Rpcs` and handler typing see an ordinary
nested router. The same `R = never` rule applies to nested services.

## Calls I made (to check)

- Names: `Procedure` (builder, core), `Router.fromService` / `Router.isService`,
  `Handlers.fromService`, `Handlers.fromProcedures`.
- `make` must be an `Effect` value (not a function) in v1, with no requirements and no failure
  (from the conversation: services are read inside handlers).
- Middleware keeps handlers on every path; nested services resolve to ordinary nested routers.
- Every entry point evaluates `make` with a memoized `runSync`; an async `make` (e.g. one that
  sleeps) is a clear runtime error, since the type cannot show it.
- Legacy `query({...})` defs keep working; mixing in a service needs `Handlers.make` for them.
- Example apps and existing docs pages are not migrated; new docs page + quick-start section.

## Left to the builder

Generic plumbing for the builder, memoization storage, JSDoc wording, sidebar placement.
