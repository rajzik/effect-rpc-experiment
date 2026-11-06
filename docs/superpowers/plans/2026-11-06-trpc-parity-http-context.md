# tRPC parity: HTTP context, request context, meta, onError, batching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Handlers can read the HTTP request and set response headers/cookies; HTTP adapters take a per-call `context` and an `onError` hook; procedures carry `meta` annotations; clients can batch queries with `httpBatchLink`.

**Architecture:** `HttpContext` (core) wraps Effect's `HttpServerRequest` service (reached through the request fiber context RpcServer merges into handler fibers) and `HttpEffect.appendPreResponseHandler`, with no requirements. `layerHttp` adds an internal server-only middleware (outermost) to the served group to implement `context` and `onError`. `.annotate` stores Effect annotations on the compiled rpc. `httpBatchLink` is a client `RpcClient.Protocol` that groups same-tick queries into one POST.

**Tech Stack:** TypeScript 7 (tsgo), Effect v4 (`effect@4.0.1`: `effect/rpc`, `effect/http`), Vite+ (`vp test`, Vitest 5).

**Spec:** `docs/superpowers/specs/2026-11-06-trpc-parity-http-context-design.md`

## Global Constraints

- Run from the repo root through Vite+ (`AGENTS.md`). Packages must be built (`pnpm exec vp run -r build`) before `pnpm check` / `vp run typecheck` / cross-package tests; run `pnpm check --fix` only after a fresh build; remove `packages/*/dist` and `packages/*/dist-types` you created when done.
- Verify every Effect API in `packages/core/node_modules/effect/dist/**/*.d.ts` (effect@4.0.1); do not trust v3 memory.
- No new dependencies; do not edit package `package.json` / `tsconfig.json` / `vite.config.ts`.
- `HttpContext` helpers have no requirements (`R = never`); they are no-ops / `None` outside HTTP.
- With neither `context` nor `onError` given, the served group and wire behaviour are unchanged.
- Every new public export: Effect-style JSDoc (`docs/jsdoc-style.md`) with a compiling example; README `## For AI agents` updated in each touched package; `node scripts/verify-jsdoc.mjs <pkg>` passes.
- Lint warnings fail; single-line disables only, with a reason.

## Review Focus

1. A subscription that sets a header after its first element: header absent, no error — test in Task 1.
2. A middleware failure (typed, from a user middleware) reaches `onError` with the procedure path — test in Task 3.
3. A user middleware reads a service provided by `context` — test in Task 4.
4. A batch with one aborted call: the other calls still succeed — test in Task 5.
5. `HttpContext.request` from `createCaller` is `None` and setters are no-ops (no defect) — test in Task 1.

---

### Task 1: `HttpContext` (core) — request and response access

**Files:**

- Create: `packages/core/src/HttpContext.ts`; export from `packages/core/src/index.ts`
- Test: `packages/core/test/httpContext.test.ts` (no-HTTP behaviour), `packages/server/test/httpContext.test.ts` (over `toWebHandler`, `createCaller`)

**Interfaces:**

- Produces (namespace-style const object `HttpContext`, like other core modules):
  - `request: Effect.Effect<Option.Option<HttpServerRequest.HttpServerRequest>>` (`Effect.serviceOption`).
  - `setHeader: (name: string, value: string) => Effect.Effect<void>`
  - `appendHeader: (name: string, value: string) => Effect.Effect<void>`
  - `setCookie: (name: string, value: string, options?: Cookies.CookieOptions) => Effect.Effect<void>` (verify the v4 cookie options type name)
  - Each setter: when a request is present, `HttpEffect.appendPreResponseHandler` applying the change to the response; otherwise `Effect.void`.

- [ ] **Step 1: Failing tests**
  - server `reads the request`: a `Router.make` query handler returning `` `${req.method} ${new URL(req.url, 'http://x').pathname}` `` from `HttpContext.request`, served by `toWebHandler`, called with a hand-built POST (see `test/wire.ts`) → `"POST /rpc"`.
  - server `sets headers and cookies`: a mutation calling `setHeader('x-a','1')`, `appendHeader('x-b','1')`, `appendHeader('x-b','2')`, `setCookie('session','abc',{ httpOnly: true, path: '/' })` → response has `x-a: 1`, `x-b` with both values, a `set-cookie` containing `session=abc`, `HttpOnly`, `Path=/`.
  - server `subscription header after first element is ignored`: subscription emitting `1`, then `setHeader('x-late','1')`, then `2` → response lacks `x-late`, both elements arrive.
  - server `caller has no request`: same handlers via `createCaller` → request `None`, setters succeed (no defect).
  - core `.test-d.ts` or type assertion in test: `HttpContext.setHeader('a','b')` is `Effect<void, never, never>`.
- [ ] **Step 2: Run** `pnpm exec vp -C packages/server test httpContext` → FAIL (module missing).
- [ ] **Step 3: Implement** `HttpContext.ts` per Interfaces.
- [ ] **Step 4: Run** core + server tests → PASS.
- [ ] **Step 5: Commit** `feat(core): HttpContext — read the request, set response headers and cookies`

### Task 2: `.annotate` (meta) on procedures

**Files:**

- Modify: `packages/core/src/Procedure.ts` (`ProcedureDef` interface ~L128, `ProcedureDefImpl` ~L451-475), `packages/core/src/ProcedureBuilder.ts` (builder state + `makeBuilder`, `Procedure.Builder` type, `withInferredSchemas` must keep annotations)
- Test: `packages/core/test/annotate.test.ts`, `packages/server/test/annotate.test.ts`

**Interfaces:**

- Produces: `annotate<I, S>(key: Context.Key<I, S>, value: S): Self` on `ProcedureDef` (returns the same definition type) and on `Procedure.Builder` (before or after other steps; kept by the terminal). Compiled rpc: `rpc.annotations` contains every annotation (applied with `rpc.annotate(key, value)` after `ProcedureKind`). Re-annotating the same key replaces the value.

- [ ] **Step 1: Failing tests**
  - core: `query({ success: Schema.String }).annotate(Roles, ['admin'])` → `Context.get(Router.getRpc(Router.make({ x: def }), 'x').annotations, Roles)` deep-equals `['admin']` (use the repo's existing way to get a compiled rpc — check `Router.getRpc`). Same through `Procedure.annotate(Roles, ['admin']).query(...)` and `Procedure.output(Schema.String).annotate(...).query(...)`; `.middleware(M)` after `.annotate` keeps it; `Router.withSchemas` over a builder procedure keeps it.
  - core: a `Context.Reference` key not set → `Context.get` returns its default.
  - server: a middleware implementation reads `Context.get(rpc.annotations, Roles)` and fails with `Forbidden` when it lacks `'admin'` → over `createCaller`, the annotated procedure fails with `Forbidden`, an unannotated one succeeds.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** core + server → PASS.
- [ ] **Step 5: Commit** `feat(core): annotate procedures (meta) for middleware`

### Task 3: Server hooks middleware + `onError`

**Files:**

- Create: `packages/server/src/internal/hooks.ts` (internal, not exported)
- Modify: `packages/server/src/Http.ts` (`ServerOptions`, `layerHttpFor`, `toWebHandlerFor`), `packages/server/src/node.ts` (pass through), `packages/next/src/routeHandler.ts`, `packages/start/src/handler.ts` (pass through if they don't already spread options)
- Test: `packages/server/test/onError.test.ts`; one pass-through assertion each in next and start tests

**Interfaces:**

- Produces:
  - `ServerOptions.onError?: (error: ServerError) => Effect.Effect<void>` with exported `interface ServerError { readonly path: string; readonly cause: Cause.Cause<unknown>; readonly headers: Headers.Headers }` (name it `OnErrorInfo` if `ServerError` clashes; check exports).
  - Internal: `hooksMiddleware` (an `RpcMiddleware.Service` with no error, no provides) and `hooksLayer(options)`; `layerHttpFor` serves `router.group.middleware(Hooks)` + provides `hooksLayer` only when `onError` (or, after Task 4, `context`) is set. Added last → outermost.
  - `onError` runs for any failure cause that is not interrupt-only, awaited before the failure is sent; failures inside `onError` itself are swallowed (`Effect.ignore`/`catchCause`) so they never change the response.
- [ ] **Step 1: Failing tests** (`toWebHandler`): typed failure → `onError` called once with `path: 'user.byId'`, the cause containing the error, request headers; defect → called; success → not called; user-middleware typed failure → called with the procedure path; `onError` that dies → client still gets the original failure; no `onError` → served group identical (no extra middleware: assert by a request that succeeds and by `router.group` unchanged). Next/Start: `onError` passed through (one test each).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm exec vp run -r test` → PASS.
- [ ] **Step 5: Commit** `feat(server): onError hook for HTTP adapters`

### Task 4: `context` option (request-level context)

**Files:**

- Modify: `packages/server/src/internal/hooks.ts`, `packages/server/src/Http.ts` (option types and generics), `packages/server/src/node.ts`, `packages/next/src/routeHandler.ts`, `packages/start/src/handler.ts`
- Test: `packages/server/test/context.test.ts`, `packages/server/test/context.test-d.ts`; pass-through in next/start tests

**Interfaces:**

- Consumes: Task 3 hooks middleware.
- Produces: `ServerOptions` (or the adapter option types) gain `context?: Effect.Effect<Context.Context<C>, never, CR>`; the hooks middleware evaluates it per call (with the handlers-layer context available for `CR`) and provides the result around the call (outermost, so user middleware also sees it). Typing: adapter `handlers` may require `C`; `C` is excluded from the adapter's unmet requirements; without `context`, a handler reading `C` is a compile error as today.
- [ ] **Step 1: Failing tests**
  - runtime: `class RequestId extends Context.Service<RequestId, string>()('RequestId') {}`; `context: Effect.map(HttpContext.request, (r) => Context.make(RequestId, Option.match(r, {...header 'x-request-id'...})))`; a handler `yield* RequestId` → echoes the header; a user middleware reads `RequestId` (Review Focus 3); `CR`: context effect reads a service `Clock2` provided in the handlers layer output (`Layer.provideMerge`) → works.
  - types: `toWebHandler(router, { handlers: HandlersNeedingRequestId, context })` compiles; without `context` → `@ts-expect-error`; same for `createRouteHandler` (next) and `createStartHandler` (start) in their `.test-d.ts`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm exec vp run -r test` + `vp run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(server): per-call context option for HTTP adapters`

### Task 5: `httpBatchLink` (client)

**Files:**

- Modify: `packages/client/src/Link.ts` (or create `packages/client/src/BatchLink.ts` if `Link.ts` would grow past its current shape; export from `index.ts`)
- Test: `packages/client/test/batchLink.test.ts` (against a `toWebHandler` via the `fetch` option, counting requests)

**Interfaces:**

- Produces: `httpBatchLink: (options: HttpBatchLinkOptions) => Link`; `HttpBatchLinkOptions = HttpLinkOptions & { readonly maxItems?: number | undefined }`. Same-tick query calls → one POST (split by `maxItems`); mutation and subscription calls → their own POST each. Kind from `Context.get(rpc.annotations, ProcedureKind)` via the group passed to `makeClient`. Responses routed by request id while streaming; headers option evaluated once per POST.
- [ ] **Step 1: Failing tests:** 3 parallel queries → 1 fetch, all 3 results correct (decoded class instances); typed failure of one query doesn't affect the others; 2 mutations in parallel → 2 fetches; a subscription streams all elements alone; `maxItems: 2` with 3 queries → 2 fetches; aborting one query of a batch → that call interrupted, others succeed (Review Focus 4); aborting all → the fetch's signal aborted; transport error (non-2xx) → every call of the batch gets `RpcTransportError`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** client + `pnpm exec vp run -r test` → PASS.
- [ ] **Step 5: Commit** `feat(client): httpBatchLink batches same-tick queries`

### Task 6: Docs

**Files:**

- Create: `site/guide/server/http-context.md` (request & response, `context`, `onError`), `site/guide/client/batching.md` (or a section in `links.md`), snippets under `site/snippets/` (type-checked by `tsgo -p site/snippets/tsconfig.json`); add pages to `site/.vitepress/sidebar.ts`
- Modify: `site/guide/server/middleware.md` (meta via `.annotate`), `site/guide/advanced/limits.md` (remove batching limit; add batch header gotcha), `site/guide/advanced/migrating-from-trpc.md` (rows: `createContext` → `context`, `meta` → `.annotate`, `onError`, `httpBatchLink`, `ctx.res`/cookies → `HttpContext`), `docs/trpc-test-parity.manual.md` + regenerate `docs/trpc-test-parity.md` with `node scripts/sync-parity-table.mjs` (batching → ported with the batch test; meta/responseMeta rows point at the new APIs) and `node scripts/verify-parity-table.mjs`; READMEs (core, server, client, next, start) incl. `## For AI agents`.
- [ ] Write; run `tsgo -p site/snippets/tsconfig.json`, `pnpm check`, verify-jsdoc core server client next start; commit `docs: http context, request context, meta, onError and batching`.

### Task 7: Full gates

- [ ] `pnpm exec vp run -r build`, `pnpm check`, `pnpm exec vp run typecheck`, `pnpm exec vp run -r test`, `node scripts/verify-jsdoc.mjs`, site snippets type-check, `node scripts/verify-parity-table.mjs` — all PASS; remove build outputs.
