# Router services whose `make` reads services — design

Date: 2026-11-06. Builds on `2026-11-05-router-service-design.md`.

## Intent

A router service's `make` may read services (`yield* AppConfig`, `yield* Database`) so that config
can shape the handlers and services are not re-read in every handler:

```ts
// router.ts
export class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const db = yield* Database;
    return {
      post: {
        byId: Procedure.input({ id: Schema.Finite })
          .output(Post)
          .error(PostNotFound)
          .query(({ id }) => db.findPost(id, { cache: cfg.cacheTtl })),
      },
    };
  }),
}) {}

// server.ts — schemas and requirements inferred from the class, no contract argument
import { AppRouter } from './router'; // './router.gen' when some schemas are inferred
import { AppRouter as AppRouterContract } from './router.client.gen';
const HandlersLive = Handlers.fromService(AppRouter).pipe(
  Layer.provide([AppConfigLive, DatabaseLive]),
); // Layer<…, never, never>; before provide: requires AppConfig | Database
await toWebHandler(AppRouterContract, { handlers: HandlersLive });

// client.ts
createClient(AppRouterContract, { url });
```

Zero users: no backward-compatibility constraints, but routers whose `make` needs nothing keep
working exactly as today (no contract needed anywhere).

## Goals

- `make: Effect<Record, E, R>` with any `E` / `R` is a valid router service ("effectful router
  service").
- `Handlers.fromService(Svc)` (one argument, as today) accepts it: `make` runs inside the layer
  with the real services, once per layer build; the router (tags, schemas, handlers) comes from
  that run. `E` and `R` (minus `Scope`) are inferred into the layer's error and requirements.
- APIs that need the router synchronously (clients, `toWebHandler`, `serve`, `createCaller`,
  framework adapters, test harness) take a **contract**: a schema-only `Router.make` router,
  normally `router.client.gen.ts` from codegen, or hand-written. Only there does a contract appear.
- Codegen reads `Effect.gen(function* () { …; return { … } })` makes, writes the contract and,
  for inferred `.output` / `.error`, a lazy `router.gen.ts` wrapper (see Codegen).

## Non-goals

- Passing an effectful service class directly to `createClient`, `toWebHandler`, `serve`,
  `createCaller`, any framework adapter or the test harness (they need the router synchronously).
- Effectful router services nested inside `Router.make` (a synchronous router) stay a compile
  error. Nesting inside another router service's `make` is supported (see Nesting).
- Schemas that depend on values read in `make` (impossible on the client by construction; codegen
  reports the location).

## Anti-goals

- A client or adapter silently running `make` (and failing at runtime on a missing service) where
  the types allowed it. Every misuse is a compile error; a forced one throws an error naming the
  fix.
- Server and client disagreeing on schemas, kind or middleware without a compile error. The
  contract decides which middleware runs: a stale contract must not silently drop `Auth`.

## Constraints

- Effect v4 APIs verified against `node_modules/effect/dist/**/*.d.ts`.
- Wire format and tags unchanged.
- Repo toolchain and gates in `AGENTS.md` (pnpm check, typecheck, tests incl. `.test-d.ts`, pack,
  verify-jsdoc, README `## For AI agents`).

## Approaches

| Approach | Trade-off | Verdict |
| --- | --- | --- |
| **1. Generated contract for sync APIs; `make` runs only in the server layer** | One definition kept; clients/adapters need codegen (or a hand-written contract) | **Picked** |
| 2. Hand-written contract only | No codegen work; schemas written twice | Rejected (still possible under 1) |
| Adapters build the router lazily inside their layers | Client still has no schemas; touches ~30 entry points | Rejected |
| Run `make` on the client with fake services | Breaks any `make` doing real top-level work | Rejected |

Within 1, an earlier draft passed the contract to `Handlers.fromService(Svc, contract)`. Rejected
by the user: the server already has the class, so everything is inferred from it.

## Design

### Core (`@effect-trpc/core`, `Router.ts`)

- `RouterService.Any` stays the pure service (`make: Effect<ServiceShape, never, never>`): accepted
  by `Router.Input` and every sync API, as today.
- New `RouterService.Effectful`: a `Context` key whose `make` is `Effect<ServiceShape, any, any>`
  (pure services satisfy it too). `Router.Of` / `Router.Record` / `Router.Rpcs` / `Router.Paths`
  work for it, nested effectful services included.
- `Router.fromService` on a forced effectful class (its sync run fails on a missing service)
  throws an error naming the fix: give that API the contract (`router.client.gen.ts`) and serve the
  class with `Handlers.fromService`.
- An Effect that builds the router of a router service (runs `make` and every nested service's
  `make` in the current context, then `Router.make`), used by `Handlers.fromService`. Each class
  runs once per evaluation; a cycle is an error naming the service.
- `Router.withSchemas(Svc, schemas)` on an effectful service returns a new effectful service class
  (same key/identifier type) whose `make` is the original `make` with the schemas patched in; no
  `make` runs at import. Its type is what `Router.WithSchemas` gives today.

### Server (`@effect-trpc/server`, `Handlers.fromService`)

- One argument, as today, now typed for `RouterService.Effectful`:
  `Layer<Handlers.Provides<Router.Of<Svc>> | Svc, MakeE, Exclude<MakeR, Scope> | Handlers.ProcedureServices<Router.Of<Svc>>>`
  where `MakeE` / `MakeR` are the unions over the outer and every nested `make`. A pure service
  gives `never` for both (unchanged type).
- Implementation: `Layer.effect` / `Layer.unwrap` running the router Effect above, then the same
  handler layer as today (`proceduresHandlers` + `toLayer`), plus `Svc` provided with the record
  this build's `make` produced. Pure services may keep the memoized sync path.

### Nesting

- An effectful `make` may return a record containing router services, effectful or pure, at any
  depth (and plain records / pure `Router.make` routers, as today). Tags are the dot-joined paths
  (`post.byId`).
- `yield* Svc` returns the outer record (nested services kept as classes, as today). Nested
  effectful service classes are not provided as services by this layer (builder's call if trivial).
- Codegen inlines nested services into the one contract, as it does today for pure ones.

### Codegen (`@effect-trpc/codegen`)

- `makeRecord` also reads `Effect.gen(function* () { …statements…; return { … } })`: the object
  literal of the generator's last top-level `return`.
- Copying a schema expression (`.input` / `.output` / `.error` / middleware) that references a
  binding declared inside the generator is a generator error with its location ("schemas must not
  depend on values read in make").
- Both modules are written as today: `router.client.gen.ts` (contract + the type-only `__contract_`
  check against `router.gen.ts`, which compares the full Rpc types — payload, success, error,
  kind, middleware) and `router.gen.ts` (`Router.withSchemas`, lazy for effectful services). The
  client module must still not import the router module at runtime.

### Docs

- `site/guide/concepts/router-services.md`: replace "`make` must not read services" with "`make`
  that reads services" (when, which APIs take the class vs the contract, serving). Keep the pure
  rule for the sync APIs.
- JSDoc for every new / changed export (`docs/jsdoc-style.md`), README + `## For AI agents` of
  core, server, codegen. Snippets under `site/snippets/concepts/` compile.

### Tests

- core: `RouterService.Effectful` / `Router.Of` types incl. nested (`.test-d.ts`); sync APIs reject
  an effectful class at compile time; forced-class error message; `withSchemas` over an effectful
  service runs no `make` at import.
- server: `Handlers.fromService(Svc)` for an effectful service serves end to end
  (`toWebHandler(contract, …)` + `createClient(contract)`); `make` runs once per layer build with
  the provided services; layer `E` / `R` inferred incl. nested (`.test-d.ts`); `yield* Svc`
  returns the record; nested effectful services served under `post.*`; inferred-output handlers
  served via the generated `router.gen.ts`.
- codegen: `Effect.gen` make → both modules; nested effectful service inlined; binding-from-make
  in a schema → error with location; `__contract_` check fails on middleware drift.

## Left to the builder

- Exact type names and error wording.
- Whether pure services keep the memoized sync path inside `Handlers.fromService` or share the
  Effect path.
- How `Router.withSchemas` builds the new class for an effectful service.
