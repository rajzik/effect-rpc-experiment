# Routers as Effect Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write a router once as a plain Effect `Context.Service` whose `make` returns procedures
built with a `Procedure` builder (schemas + handler), accepted by every API, with all types and
handler requirements inferred.

**Architecture:** Core gains the `Procedure` builder (a `ProcedureDef` that also carries its
handler) and `Router.fromService` (memoized `runSync` of `make` → `Router.make`), plus a single
normalizer every entry point calls. Server gains `Handlers.fromService` / `fromProcedures`, which
build the rpc handler layer from the procedures' own handlers. Adapters call the normalizer; no
special cases.

**Tech Stack:** TypeScript 7 (tsgo), Effect v4 (`Context.Service`, `Effect.fn`, `Layer`,
`effect/rpc`), Vitest 5 via Vite+, pnpm 11 workspace.

**Spec:** `docs/superpowers/specs/2026-11-05-router-service-design.md`

## Global Constraints

- Branch `t3code/router-service` (stacked on `t3code/framework-examples`, PR #5). PR at the end.
- No new dependencies.
- Existing APIs unchanged and all existing tests green: `query`/`mutation`/`subscription`,
  `Router.make`, `Handlers.make`, every adapter signature (they gain accepted input types only).
- `make` of a router service: an `Effect` **value** with no requirements and no failure
  (`Effect<Record, never, never>`); services are read inside handlers. A `make` that needs services
  is a compile error at every entry point; an async `make` is a clear runtime error.
- `make` is evaluated once per class per process (memoized), whichever APIs use it.
- Package boundaries: `Procedure`, `Router.fromService`, `Router.isService` and the normalizer in
  `@effect-trpc/core`; `Handlers.fromService`, `Handlers.fromProcedures` in `@effect-trpc/server`.
- Names exactly: `Procedure`, `Router.fromService`, `Router.isService`, `Handlers.fromService`,
  `Handlers.fromProcedures`.
- Repo rules (AGENTS.md): Effect-style JSDoc with compiling examples on every export; `.test-d.ts`
  for every typed claim; README `## For AI agents` and `test/PARITY.md` updated; `pnpm check`
  (`--deny-warnings`), per-line reasoned disables only; `node scripts/verify-jsdoc.mjs` passes.

## Review Focus

1. **`make` without `as const`** — a reasonable user omits it; paths, inputs and outputs must still
   infer (the record's keys are literal anyway). Pinned in Task 2's type test
   `infers the router from make without as const`.
2. **Async or failing `make` at runtime** (e.g. `Effect.sleep` inside, or a cast that hides `R`) —
   the user must get an error naming the service and the rule, not an Effect `AsyncFiberException`.
   Pinned in Task 2's test `fromService throws a clear error for an async make`.
3. **A legacy `query({...})` def inside a service** — `Handlers.fromService` must reject it at compile
   time with a readable type (or a clear runtime error if forced), not produce a layer missing a
   handler. Pinned in Task 3: `fromService rejects procedures without handlers` (type + runtime).
4. **Subscription handlers that read services** — requirements of a `Stream` handler must be
   inferred like Effect handlers. Pinned in Task 3's type test `infers requirements from a Stream
   handler`.
5. **Router-level middleware on a service router** — handlers must survive `router.middleware(M)` and
   middleware-provided services must not appear as requirements. Pinned in Task 3:
   `middleware keeps handlers and removes provided services from requirements`.

---

### Task 1: `Procedure` builder (core)

**Files:**

- Create: `packages/core/src/ProcedureBuilder.ts` (exported as `Procedure` from `src/index.ts`)
- Modify: `packages/core/src/Procedure.ts` (`ProcedureDefImpl` keeps an optional `handler` through
  `middleware()`; `ProcedureDef.AddMiddleware` carries the handler type), `src/index.ts`, README
- Test: `packages/core/test/procedureBuilder.test.ts`, `packages/core/test/procedureBuilder.test-d.ts`

**Interfaces (Produces):**

- `Procedure.input(fields | schema)`, `.output(schema)`, `.error(schema)`, `.middleware(M)` — each
  optional, any order before a terminal, immutable.
- Terminals: `.query(handler)`, `.mutation(handler)`, `.subscription(handler)` returning
  `ProcedureWithHandler<Kind, P, S, E, M, Rq, HandlerR>`, which `extends ProcedureDef<Kind, P, S, E,
  M, Rq>` and has `readonly handler`.
- Handler types: query/mutation `(payload: P['Type'], ctx: HandlerContext) => Effect<S['Type'],
  E['Type'] | MiddlewareErrors, R>`; subscription `(payload, ctx) => Stream<S['Type'], E['Type'] |
  MiddlewareErrors, R>`. `HandlerContext` = the `effect/rpc` handler context (`headers`,
  `requestId`, `rpc`, `client`), same as `Handlers.make` handlers receive.
- Type helper `Procedure.HandlerRequirements<P>` → `R`.

- [ ] **Step 1: Tests first.** Runtime: `builder procedures compile to the same rpc as query({...})`
      (same tag, payload/success/error schemas, `ProcedureKind` annotation); `middleware() keeps the
  handler` (before and after the terminal); `defaults are Void / Void / Never`. Types:
      `handler payload is inferred from input` (`id: number`); `wrong success type is rejected`
      (`@ts-expect-error`); `undeclared error is rejected`; `middleware errors are allowed`;
      `R is recorded` (`Procedure.HandlerRequirements` equals `Database`); `inferInput/Output/Error`
      equal those of the equivalent `query({...})`.
- [ ] **Step 2:** `pnpm exec vp -C packages/core test` → FAIL (no `Procedure`).
- [ ] **Step 3:** Implement. Reuse `define`/`ProcedureDefImpl` for the def part.
- [ ] **Step 4:** Tests PASS; `pnpm check`; existing core tests unchanged.
- [ ] **Step 5: Commit** `feat(core): Procedure builder with handlers`.

### Task 2: Routers from services (core)

**Files:**

- Modify: `packages/core/src/Router.ts` (`Router.isService`, `Router.fromService`, normalizer,
  `Router.make` accepting service entries, type helpers), `src/index.ts`, README
- Test: `packages/core/test/routerService.test.ts`, `packages/core/test/routerService.test-d.ts`

**Interfaces (Produces):**

- `Router.isService(u): u is RouterService.Any` — a class with `ServiceTypeId`/`Context` key shape
  and a static `make` that is an Effect.
- `Router.fromService<S extends RouterService.Any>(svc: S): Router<RecordOf<S>>` — memoized per class
  (WeakMap), `Effect.runSync(svc.make)`; throws `Error` mentioning the service key and "make must
  not require services or be asynchronous" on failure/async.
- `Router.Input` = `Router.Any | RouterService.Any`; `Router.Of<X>` = router type for either;
  `Router.from(x: Router.Input): Router.Any` (the normalizer every adapter calls).
- `RouterService.Any` = `{ readonly make: Effect<Router.Shape, never, never> } & Context.Key<any, any>`
  (compile-time rule: a `make` with requirements does not satisfy it).
- Type helpers accept `Router.Input`: `inferRouterInputs/Outputs/Errors`, `Router.Paths`,
  `Router.Rpcs`.

- [ ] **Step 1: Tests first.** Runtime: `fromService builds the router from make`; `make runs once
  per class` (counter in `Effect.sync`); `Router.make nests a service` (`Router.make({ admin:
  AdminSvc })` has tag `admin.x`); `a service's make may nest routers and services`;
      `fromService throws a clear error for an async make` (Review Focus 2). Types: `infers the router
  from make without as const` (Review Focus 1); `typeof Svc works with inferRouterInputs and
  Router.Paths`; `a make that requires a service is rejected by Router.from`.
- [ ] **Step 2:** RED. **Step 3:** Implement. **Step 4:** GREEN + existing tests + `pnpm check`.
- [ ] **Step 5: Commit** `feat(core): routers from Effect services`.

### Task 3: Implementations from procedures (server)

**Files:**

- Modify: `packages/server/src/Handlers.ts` (`fromService`, `fromProcedures`), README,
  `test/PARITY.md` if relevant
- Test: `packages/server/test/routerService.test.ts`, `packages/server/test/routerService.test-d.ts`

**Interfaces:**

- Consumes: Task 1 `ProcedureWithHandler`, Task 2 `Router.from`, `Router.Of`.
- Produces: `Handlers.fromService(svc)`: `Layer<Handlers.Provides<Router.Of<S>> | S['Identifier'],
  never, ExcludeMiddlewareProvided<HandlerRequirements>>` (provides the rpc handlers and the service
  itself); `Handlers.fromProcedures(router)`: same without the service.

- [ ] **Step 1: Tests first.** Runtime: end to end through `createCaller` and `toWebHandler` +
      `httpLink` with a service router (class instances and typed errors decoded); `yield* Svc` inside a
      program provided with `Handlers.fromService(Svc)` returns the procedures record; `fromService
  rejects procedures without handlers` (Review Focus 3, runtime: forced via cast → clear error);
      `middleware keeps handlers and removes provided services from requirements` (Review Focus 5).
      Types: `requirements are inferred` (`Database`); `infers requirements from a Stream handler`
      (Review Focus 4); `fromService rejects procedures without handlers` (compile error).
- [ ] **Step 2:** RED. **Step 3:** Implement on top of `Handlers.make`'s internals (same tags, same
      layer semantics). **Step 4:** GREEN + server tests + `pnpm check`.
- [ ] **Step 5: Commit** `feat(server): Handlers.fromService and fromProcedures`.

### Task 4: Every adapter accepts a router service

**Files:** entry points in `packages/{client,server,tanstack-react-query,next,start,electron,test-utils}/src`
(each takes `Router.Input` and calls `Router.from` once at entry); one type test + one runtime test
per package (`test/routerService.test(-d).ts(x)`).

- [ ] **Step 1: Tests first.** Per package, the existing main entry used with a service router:
      client `createClient` (Promise + `$effect`, decoded instances); server `createCaller`,
      `toWebHandler`, `layerHttp`, node `runServer`; tanstack `createRpcOptionsProxy`,
      `createRpcContext`, `createHydrationHelpers` (dehydrate/hydrate instances); next
      `createRouteHandler`, `createRscHelpers`, `createServerActionCaller`; start `createStartHandler`,
      `createIsomorphicClient`, `createStartHelpers`; electron `MainRpcServer.run` +
      `messagePortLink`; test-utils `testServerAndClient`. Type tests: each accepts `typeof Svc` and its
      inferred types equal the `Router.make` equivalent.
- [ ] **Step 2:** RED. **Step 3:** Widen parameter types to `Router.Input`/`Router.Of`, normalize at
      entry. **Step 4:** GREEN for all packages, `pnpm exec vp run -r test`, `vp run typecheck`.
- [ ] **Step 5: Commit** `feat: accept router services in every adapter`.

### Task 5: Docs

**Files:** READMEs (core, server, client, tanstack, next, start, electron — a line each where the
router is accepted), `site/guide/concepts/router-services.md` (+ sidebar), `site/guide/quick-start.md`
("Or as a service" section), snippets `site/snippets/concepts/router-service.ts` (type-checked),
API reference regenerates automatically.

- [ ] **Step 1:** Write the page: the service form, the `make` rule and why (clients evaluate `make`;
      services go inside handlers; one-time setup in service layers), `Handlers.fromService`, nesting,
      middleware, mixing with `query({...})`, gotchas (handler code ships to the browser; legacy defs
      need `Handlers.make`).
- [ ] **Step 2:** `pnpm -C site docs:snippets`, `pnpm docs:build`, `pnpm -C site docs:test`,
      `node scripts/verify-jsdoc.mjs`, `pnpm ready` all pass.
- [ ] **Step 3: Commit** `docs: routers as Effect services`. Then final review, push, PR (base
      `t3code/framework-examples`), watch checks.
