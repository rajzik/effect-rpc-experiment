# Effectful router-service `make` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A router service's `make` may read services; `Handlers.fromService(Svc)` runs it inside its layer with everything inferred, while clients and sync adapters use the generated contract.

**Architecture:** Core gains an "effectful" router-service type and an Effect that builds a service's router (nested services included) in the current context. `Handlers.fromService` becomes a `Layer.unwrap` over that Effect. `Router.withSchemas` over an effectful service returns a lazy wrapper service with the same key. Codegen learns `Effect.gen` makes and rejects schemas that depend on values read in `make`.

**Tech Stack:** TypeScript 7 (tsgo), Effect v4 (`effect@4.x`, `effect/rpc`), Vite+ (`vp test`, Vitest 5), `@effect-trpc/*` monorepo.

**Spec:** `docs/superpowers/specs/2026-11-06-router-service-effectful-make-design.md`

## Global Constraints

- Run everything from the repo root through Vite+: `pnpm check`, `vp run typecheck`, `vp -C packages/<name> test`, `vp -C packages/<name> pack`, `node scripts/verify-jsdoc.mjs <name>` (see `AGENTS.md`).
- Verify every Effect API against `packages/core/node_modules/effect/dist/*.d.ts` (do not trust v3 memory). Verified: `Layer.unwrap(Effect<Layer<A,E1,R1>,E,R>): Layer<A, E|E1, R1|Exclude<R,Scope>>`; `Context` looks services up by `key` string.
- Wire format and tags unchanged. Pure services (`make: Effect<_, never, never>`) behave exactly as today everywhere.
- `Router.Input` (what `createClient`, `toWebHandler`, `serve`, `createCaller`, every framework adapter and the test harness take) stays pure-only: an effectful class there is a compile error.
- `Router.make({...})` must keep rejecting an effectful service at compile time (its `ServiceShape` stays pure).
- Every new / changed public export: Effect-style JSDoc per `docs/jsdoc-style.md` with a compiling example; README `## For AI agents` updated in core, server, codegen.
- Lint: warnings fail; disable a single line only with `// oxlint-disable-next-line <rule> -- <reason>`.
- Do not edit package `package.json` / `tsconfig.json` / `vite.config.ts`.

## Review Focus

1. A `make` that reads a service *and* nests a pure service and a plain `Router.make` router: tags `a.b.c` resolve exactly as today — test in Task 4 (`nested mix`).
2. Two layer builds (e.g. two `toWebHandler` calls) each run `make` once with their own services; nothing is memoized across builds — test in Task 4 (`make runs per build`).
3. A `make` that fails with a typed error: the layer build fails with that error (typed `E` on the layer) — test in Task 4 (`make failure`).
4. A forced effectful class passed to `createClient` / `Router.from`: throws an error naming `Handlers.fromService` and `router.client.gen.ts`, and leaves no running fiber — test in Task 2.
5. A schema in `make` built from a value read in `make` (`const cfg = yield* AppConfig; Procedure.input(cfg.schema)`): codegen error with file:line, not a copied `yield*` — test in Task 5.

---

### Task 1: Core types for effectful router services

**Files:**
- Modify: `packages/core/src/Router.ts` (namespace `Router` ~L140-317, namespace `RouterService` ~L356-366, `ServiceRecord` / `Resolve` / `ResolveEntry` / `EntryHasService` / `RecordOf` ~L368-405)
- Modify: `packages/core/src/index.ts` only if a new top-level export is needed (type-only additions live in existing namespaces)
- Test: `packages/core/test/routerServiceEffectful.test-d.ts`

**Interfaces:**
- Produces:
  - `RouterService.Effectful = Context.Key<any, any> & { readonly make: Effect.Effect<RouterService.EffectfulShape, unknown, unknown> }` (pure services satisfy it).
  - `RouterService.EffectfulShape = { readonly [key: string]: ProcedureDef.Any | Router.Any | RouterService.Effectful | RouterService.EffectfulShape }`.
  - `RouterService.MakeError<S>` / `RouterService.MakeServices<S>`: union of `E` / `R` of `S.make` and of every nested router service's `make` (recursive through plain records; `Router` values contribute `never`).
  - `Router.Of`, `Router.Record`, `Router.Rpcs`, `Router.Paths` accept `RouterService.Effectful` (and resolve nested effectful services). `Resolve` / `EntryHasService` / `ResolveEntry` detect `RouterService.Effectful`.
  - Unchanged: `RouterService.Any`, `Router.Input`, `Router.ServiceShape`.

- [ ] **Step 1: Write the failing type test** `routerServiceEffectful.test-d.ts` with services `AppConfig` (`{ prefix: string }`), `Database`, error `ConfigError` (`Schema.TaggedError`), and:
  - `PostRouter` — `make: Effect.gen(function* () { const db = yield* Database; return { byId: Procedure.input({ id: Schema.Finite }).output(Schema.String).query(...) } })`
  - `AppRouter` — `make: Effect.gen(function* () { const cfg = yield* AppConfig; if (...) return yield* new ConfigError(); return { health: Procedure.output(Schema.String).query(() => Effect.succeed(cfg.prefix)), post: PostRouter } })`
  - Assertions (`expectTypeOf`):
    - `AppRouter` extends `RouterService.Effectful`; does **not** extend `RouterService.Any` / `Router.Input`.
    - `Router.Paths<typeof AppRouter>` equals `'health' | 'post.byId'`.
    - `RouterService.MakeError<typeof AppRouter>` equals `ConfigError`; `RouterService.MakeServices<typeof AppRouter>` equals `AppConfig | Database`.
    - A pure service: `MakeError` / `MakeServices` are `never`, still extends `RouterService.Any`.
    - `// @ts-expect-error` on `Router.make({ post: PostRouter })` and on `Router.from(AppRouter)`.

- [ ] **Step 2: Run** `vp -C packages/core test routerServiceEffectful` — Expected: type errors (missing `RouterService.Effectful` etc.).

- [ ] **Step 3: Implement the types** in `Router.ts` as listed in Interfaces. `ServiceRecord<S>` keeps inferring `Rec` ignoring `E`/`R`; `Resolve` must map nested effectful classes to `Router<ServiceRecord<V>>`.

- [ ] **Step 4: Run** `vp -C packages/core test` — Expected: all pass, incl. existing `routerService.test-d.ts`.

- [ ] **Step 5: Commit** `feat(core): type effectful router services`

### Task 2: Core runtime — build a service's router as an Effect

**Files:**
- Modify: `packages/core/src/Router.ts` (`runMake` ~L638, `fromService` ~L705, add `buildService`, export in the `Router` value object)
- Test: `packages/core/test/routerServiceEffectful.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces: `Router.buildService: <S extends RouterService.Effectful>(service: S) => Effect.Effect<{ readonly router: Router.Of<S>; readonly value: Context.Service.Shape<S> }, RouterService.MakeError<S>, RouterService.MakeServices<S>>`
  - Runs `service.make` in the current context, then resolves nested router services (effectful or pure) by running their `make` the same way (each class at most once per `buildService` run; a cycle fails with the existing "nests the service itself" error as a defect), then `Router.make` on the resolved record. `value` is the record `make` returned (nested services kept as classes). Not memoized across runs. Validates "record, not a router" like `fromService`.

- [ ] **Step 1: Write failing tests** (`it.effect` from `@effect/vitest`):
  - `buildService runs make with provided services` — `AppRouter` from Task 1 provided `AppConfig`/`Database`; `router.procedures` keys equal `['health', 'post.byId']`; `value.post === PostRouter`.
  - `make runs once per run` — a counter `Ref` in `make`; two `buildService` runs → counter 2; one run of a router nesting the same service twice → that service's counter 1.
  - `make failure` — `make` failing with `ConfigError` → `Effect.flip` yields `ConfigError`.
  - `forced effectful class in Router.from throws` — `Router.from(AppRouter as never)` throws an `Error` whose message contains `"AppRouter"`, `Handlers.fromService` and `router.client.gen.ts`.
  - `pure service via buildService equals Router.fromService tags`.

- [ ] **Step 2: Run** `vp -C packages/core test routerServiceEffectful` — Expected: FAIL (`buildService` undefined; old error text).

- [ ] **Step 3: Implement** `buildService` and change the `runMake` error for a missing-service failure to: `make reads services, so this API cannot build the router: give it the contract (router.client.gen.ts) and serve the class with Handlers.fromService` (keep the existing async / failure wording for other causes; keep interrupting a left-running fiber). Share record validation / nested resolution with `fromService` where it reduces code.

- [ ] **Step 4: Run** `vp -C packages/core test` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(core): build an effectful router service's router as an Effect`

### Task 3: Core — `Router.withSchemas` over an effectful service

**Files:**
- Modify: `packages/core/src/Router.ts` (`withSchemas` ~L1100 and its JSDoc)
- Test: `packages/core/test/routerWithSchemas.test.ts`, `packages/core/test/routerWithSchemas.test-d.ts`

**Interfaces:**
- Consumes: `Router.buildService` (Task 2).
- Produces: for a router **service** source (pure or effectful — runtime cannot tell them apart without running `make`), `withSchemas(source, schemas): RouterService.WithSchemas<X, S>` where
  `RouterService.WithSchemas<X, S> = Context.Key<Context.Service.Identifier<X>, Context.Service.Shape<X>> & { readonly make: Effect.Effect<Router.WithSchemas<Router.Record<X>, S>, RouterService.MakeError<X>, RouterService.MakeServices<X>> }`.
  Runtime: a new key object with the **same `key` string** as `source` whose `make` is `Router.buildService(source)` mapped to `patchRecord(router.record, schemas, [])`. Runs nothing at call time. For a pure source the wrapper is itself pure (`MakeError`/`MakeServices` are `never`), so it is still a `Router.Input` and every adapter accepts it. A `Router` source keeps today's overload and return type (`Router<…>`).
  Decision (zero users): a service source no longer returns a `Router`; callers use `Router.from(wrapped)` / `Handlers.fromService(wrapped)`.

- [ ] **Step 1: Write failing tests**
  - runtime `withSchemas over an effectful service runs no make at import` — counter in `make` stays 0 after `withSchemas(...)`; after `buildService(wrapped)` with services provided, the inferred procedure's success schema is the given `Post` and its handler returns a `Post` without the inference-guard defect.
  - runtime: `wrapped.key === AppRouter.key`.
  - type: `Router.Rpcs<typeof wrapped>` success for the patched path is `Post`; `RouterService.MakeServices<typeof wrapped>` equals the source's; a schema for a missing path is a compile error.

- [ ] **Step 2: Run** `vp -C packages/core test routerWithSchemas` — Expected: FAIL.

- [ ] **Step 3: Implement** the two overloads (router source / service source). Then update every caller that treated `withSchemas(Service, …)` as a router: grep `withSchemas(` in `packages/*/src`, `packages/*/test`, `site/`, `examples/`; `.record` access becomes `Router.from(x).record`, `Handlers.fromProcedures(withSchemas(Service, …))` becomes `Handlers.fromService(withSchemas(Service, …))`. Update the `withSchemas` JSDoc (result is a service for a service source).

- [ ] **Step 4: Run** `vp -C packages/core test` and `vp -C packages/server test` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(core): lazy Router.withSchemas over router services`

### Task 4: Server — `Handlers.fromService` for effectful services

**Files:**
- Modify: `packages/server/src/Handlers.ts` (`fromService` ~L573 and its JSDoc)
- Test: `packages/server/test/routerServiceEffectful.test.ts`, `packages/server/test/routerServiceEffectful.test-d.ts`
- Modify: `packages/server/test/PARITY.md` only if it lists router-service tests

**Interfaces:**
- Consumes: `Router.buildService`, `RouterService.Effectful`, `MakeError`, `MakeServices`.
- Produces: `Handlers.fromService: <S extends RouterService.Effectful>(service: S & Handlers.RequireHandlers<Router.Of<S>>) => Layer.Layer<Handlers.Provides<Router.Of<S>> | Context.Service.Identifier<S>, RouterService.MakeError<S>, Exclude<RouterService.MakeServices<S>, Scope.Scope> | Handlers.ProcedureServices<Router.Of<S>>>`.
  Implementation: `Layer.unwrap(Effect.map(Router.buildService(service), ({ router, value }) => Layer.merge(toLayer(router, proceduresHandlers(router, …)), Layer.succeed(key)(value))))`. Pure services may use this path too (types reduce to today's).

- [ ] **Step 1: Write failing tests**
  - `serves end to end` — `AppRouter` (Task 1 shape, `PostRouter` nested) + a hand-written contract `Router.make({ health: query({ success: Schema.String }), post: { byId: query({ payload: { id: Schema.Finite }, success: Schema.String }) } })`; `toWebHandler(contract, { handlers: Handlers.fromService(AppRouter).pipe(Layer.provide([AppConfigLive, DatabaseLive])) })`; `createClient(contract, …)` via the existing `test/http-client.ts` helper: `health` returns the config prefix, `post.byId` returns the DB value.
  - `make runs per build` — two `toWebHandler` builds → counter 2.
  - `make failure` — layer build fails with `ConfigError`.
  - `yield* AppRouter returns the record` — `.post === PostRouter`.
  - `nested mix` — effectful outer `make` returning `{ a: { b: PureService }, c: Router.make({ d: Procedure... }) }`: tags `a.b.x`, `c.d` served.
  - `.test-d.ts`: layer type for `AppRouter` is `Layer<Rpc.Handler<'health'> | Rpc.Handler<'post.byId'> | AppRouter, ConfigError, AppConfig | Database>`; for a pure service it equals today's type; handler-read services and middleware-provided services (`CurrentUser` via `Auth`) behave as in `routerService.test-d.ts`; `toWebHandler(AppRouter, …)` is `@ts-expect-error`.

- [ ] **Step 2: Run** `vp -C packages/server test routerServiceEffectful` — Expected: FAIL.

- [ ] **Step 3: Implement** per Interfaces.

- [ ] **Step 4: Run** `vp -C packages/server test` and `vp run -r test` — Expected: PASS (all adapters untouched).

- [ ] **Step 5: Commit** `feat(server): serve router services whose make reads services`

### Task 5: Codegen — `Effect.gen` makes

**Files:**
- Modify: `packages/codegen/src/generate.ts` (`makeRecord` ~L213, `copyExpression` ~L890, server export emission ~L1158)
- Test: `packages/codegen/test/generate.test.ts`, `packages/codegen/test/clientTypes.test-d.ts`, fixtures under `packages/codegen/test/fixtures/`

**Interfaces:**
- Consumes: `Router.withSchemas` (Task 3), `Handlers.fromService` (Task 4).
- Produces:
  - `makeRecord` reads `Effect.gen(function* () { …; return { … } })` (the object literal of the generator body's last top-level `return`), in addition to `Effect.succeed` / `Effect.sync`.
  - `copyExpression`: an identifier whose declaration is inside the router class's `make` initializer → `Unmappable('<name> is read in make: schemas must not depend on values read in make (declare the schema at module level)')`.
  - `router.gen.ts` for a service: `Router.withSchemas(__source_X, tree)` unchanged text (it is now a lazy service; update the header comment to say serve with `Handlers.fromService`). A `Router.make` constant source still yields a router. `router.client.gen.ts` unchanged (type-only `__contract_` check against it).

- [ ] **Step 1: Write failing tests** in `generate.test.ts` (follow its existing fixture style):
  - `Effect.gen make` — router file with `make: Effect.gen(function* () { const db = yield* Database; return { byId: Procedure.input({ id: Schema.Finite }).query(({ id }) => db.find(id)) } })` where `db.find` returns `Effect<Post, PostNotFound>`: client module equals `Router.make({ byId: __query({ payload: { id: Schema.Finite }, success: Post, error: PostNotFound }) })` (exact text per existing snapshots); server module wraps with `withSchemas`.
  - `nested effectful service inlined` — `{ post: PostRouter }` → `post: { byId: … }` in the client record.
  - `schema read in make` — `Procedure.input(cfg.schema)` with `const cfg = yield* AppConfig` → generator error containing `cfg is read in make` and `router.ts:<line>`.
  - `clientTypes.test-d.ts`: the generated `__contract_X` is `'up to date'` for the effectful fixture; adding `.middleware(Auth)` to the server procedure only makes it the out-of-date literal.
  - Update fixtures / snapshots whose server module is now served with `Handlers.fromService` instead of `Handlers.fromProcedures`.

- [ ] **Step 2: Run** `vp -C packages/codegen test` — Expected: FAIL.

- [ ] **Step 3: Implement** per Interfaces.

- [ ] **Step 4: Run** `vp -C packages/codegen test` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(codegen): read Effect.gen router-service makes`

### Task 6: Docs, JSDoc, READMEs

**Files:**
- Modify: `site/guide/concepts/router-services.md` (section "`make` must not read services" → "`make` that reads services"; "Inferred schemas" serving line; Gotchas bullets about `make` needing services)
- Create: `site/snippets/concepts/router-service-effectful.ts` (`#service`, `#server`, `#client` regions; must type-check like other snippets)
- Modify: `site/guide/advanced/codegen.md` if it says to serve the gen module with `Handlers.fromProcedures`
- Modify: `packages/core/README.md`, `packages/server/README.md`, `packages/codegen/README.md` (API + `## For AI agents`: invariants "sync APIs take the contract when make reads services", common mistake "passing the class to createClient")
- Modify: JSDoc of `RouterService`, `Router.fromService`, `Router.buildService`, `Router.withSchemas`, `Handlers.fromService`

- [ ] **Step 1:** Write the doc page section with: when to read services in `make`; which APIs take the class (`Handlers.fromService`) vs the contract (everything else); the server/client snippet; nesting; the error text a forced class throws.
- [ ] **Step 2: Run** the site/snippet type-check used by the repo (`vp run typecheck`) — Expected: PASS.
- [ ] **Step 3: Run** `vp -C packages/core pack && vp -C packages/server pack && vp -C packages/codegen pack && node scripts/verify-jsdoc.mjs core server codegen` — Expected: PASS.
- [ ] **Step 4: Commit** `docs: router services whose make reads services`

### Task 7: Full gates

- [ ] `pnpm check` — PASS
- [ ] `vp run typecheck` — PASS
- [ ] `vp run -r test` — PASS
- [ ] `vp run -r build` — PASS
- [ ] `node scripts/verify-jsdoc.mjs` — PASS
- [ ] Remove build outputs the task created that are not tracked; `git status` shows only intended changes.
