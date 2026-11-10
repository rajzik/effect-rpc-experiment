# Framework Examples Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Next.js, TanStack Start and Electron example apps sharing one task-board domain, each
tested by Playwright against its production build, in CI.

**Architecture:** `examples/shared` holds the router, the server layer (handlers + auth), shared
React components and Playwright page objects. Each framework app wires them the framework's way
(providers, RSC/server actions, loaders, main/preload/renderer) and owns a Playwright suite that runs
the shared scenarios plus its own.

**Tech Stack:** Next.js 16, TanStack Start/Router 1.x, Electron 44, React 19, TanStack Query 5,
Effect v4, effect-trpc workspace packages (built `dist`), `@playwright/test` (Chromium), pnpm 11.

**Spec:** `docs/superpowers/specs/2026-11-05-framework-examples-design.md`

## Global Constraints

- Branch `t3code/framework-examples` (stacked on `t3code/lint-zero`, PR #4). PR opened at the end.
- Approved new dev deps: `@playwright/test`; catalog `next`, `@tanstack/react-start`,
  `@tanstack/react-router`, `@tanstack/react-query`, `react`, `react-dom`, `electron`;
  `@tanstack/router-plugin` if Start needs it; an Electron bundler from what the workspace has (Vite+
  `vp pack` / Vite). Anything else: ask first.
- `allowBuilds: electron: true` (Electron binary on install), unless the spike shows a cheaper way.
- Example scripts are prefixed `example:` (`example:build`, `example:start`, `example:test`), so
  `vp run -r build|test`, `pnpm ready` and `ci.yml` are unchanged. Root: `pnpm examples:test`.
- Lint: examples pass `pnpm check` (`--deny-warnings`); per-line reasoned disables only.
- Apps consume `@rpc-effect/*` via `workspace:*` (built `dist`), Effect v4 APIs only.
- Library bugs found: fix in `packages/*` in their own commit, failing unit test first (plus
  `.test-d.ts` if types change), README / `test/PARITY.md` updated, full `pnpm ready` green. Never
  skip or weaken an example test to pass.
- Tests: no fixed sleeps (wait on visible state); Chromium only; `workers: 1` per app; retries 0
  locally, 1 in CI; traces on failure.
- Test-only `testing.reset` works only when `EXAMPLES_TEST=1`; otherwise it dies (defect).

## Review Focus

1. **Production-only transport behavior** — a subscription streamed through `next start` / Start's
   built server / Electron must deliver each element as it happens (no buffering until the stream
   ends). Pinned by scenario 5 ("live update arrives within 5s while the stream stays open") in each
   app's suite.
2. **Session reaching middleware on every server path** — cookies must reach `Auth` through the
   route handler, RSC (`createRscHelpers` `headers`), server actions and Start loaders. Pinned by
   "SSR shows the signed-in user's name" (Next RSC, Start loader) and "server action as guest →
   Forbidden".
3. **Hydration mismatches and runtime errors in the browser** — a page that "works" but logs a React
   hydration error or an uncaught error is a failure. Pinned by the shared `failOnConsoleErrors`
   fixture in every suite (fails on `pageerror` and `console.error`).
4. **Test isolation** — state from one test must not leak into the next. Pinned by `beforeEach`
   calling `testing.reset` and a test that creates a task then asserts a fresh test sees seed only.
5. **Electron hardening in the real runtime** — `contextIsolation`/`sandbox` on, nothing on
   `window`. Pinned by the Electron test "preload exposes nothing" (`window.ipcRenderer` and
   `window.require` undefined).

---

### Task 1: Spikes — TanStack Start on the Vite+ core, Electron binary + Playwright

**Files:** throwaway under `examples/start/` and `examples/electron/` (kept only if they become the
real scaffold in Tasks 4–5); `pnpm-workspace.yaml` (`allowBuilds`).

- [ ] **Step 1:** Minimal Start app (`createStartHandler` server route + one page) with
      `@tanstack/react-start/plugin/vite`; `vite build` then start the built server; `curl` the page and
      `POST /api/rpc`. Expected: 200 HTML, rpc answers. Fallback: scoped `"@tanstack/react-start>vite"`
      (or the example's own `vite`) override to real Vite 7/8. If both fail: stop, report to user.
- [ ] **Step 2:** `allowBuilds: electron: true`, `pnpm install`; Playwright `_electron.launch` of a
      10-line main that opens a window; read its title. Expected: title read, app closes. If the binary
      download is the only blocker in CI, note it for Task 6.
- [ ] **Step 3:** Ledger rulings (which option worked); commit the scaffolds that survive, delete the
      rest. Commit `chore(examples): spike Start on Vite+ and Electron launch`.

### Task 2: Shared domain, server layer, UI and page objects

**Files:**

- Create: `examples/shared/package.json` (`@rpc-effect-examples/shared`, private, exports `.`,
  `./server`, `./ui`, `./e2e`), `src/domain.ts`, `src/server.ts`, `src/store.ts`, `src/ui/*.tsx`,
  `src/e2e/*.ts`, `test/server.test.ts`, `tsconfig.json`
- Modify: root `vite.config.ts` only if lint needs an override for `examples/**/e2e/**` (Playwright
  globals); `pnpm-workspace.yaml` unchanged (glob exists).

**Interfaces (Produces):**

- `src/domain.ts`: `Task` (`id: Schema.Finite`, `title`, `done: Schema.Boolean`, `assignee`,
  `createdAt: Schema.Date`, `dueAt: Schema.optional(Schema.Date)`, getter `isOverdue: boolean`),
  `TaskPage` (`items`, `nextCursor: NullOr(Finite)`), errors `TaskNotFound{id}`,
  `Forbidden{reason}`, `Unauthorized{}`, `ValidationFailed{field, message}`, `User` class
  (`name`, `role: 'member' | 'guest'`), service `CurrentUser` (`User`), middleware `Auth`
  (`provides: CurrentUser`, `error: Unauthorized`), `appRouter`:
  `session.me` (query → `User`, Auth), `tasks.list` (query `{cursor?}` → `TaskPage`, page size 5),
  `tasks.byId` (`{id}` → `Task` | `TaskNotFound`), `tasks.create` (`{title}` → `Task` |
  `Forbidden` | `ValidationFailed`, Auth), `tasks.toggle` (`{id}` → `Task` | `TaskNotFound` |
  `Forbidden`, Auth), `tasks.onChanged` (subscription → `Task`), `testing.reset` (mutation → void).
  `type AppRouter`.
- `src/server.ts`: `makeServerLive(options: { readonly resolveUser: (headers: Readonly<Record<string,
  string | undefined>>) => string | undefined }): Layer<Handlers.Requirements<AppRouter>>`;
  `cookieUser(headers)` reads cookie `session=<name>`; users: `ada` (member), `grace` (member),
  `guest` (guest). Seed: 12 tasks, one overdue, ids 1–12.
- `src/ui`: `TaskList`, `TaskDetail`, `NewTaskForm`, `LiveFeed`, `SignedInAs` — each takes
  `rpc: RpcOptionsProxy<AppRouter>` (and ids) as props, renders accessible roles/labels:
  list `role=list name="Tasks"`, button "Load more", textbox "Title", button "Create", alert role for
  typed errors with text `Task #<id> not found` / `Forbidden: <reason>` / `Sign in first` /
  `Title: <message>`, status "Live: <title>", text `Signed in as <name>`, task row shows `Overdue`.
  `NewTaskForm` takes `submit: (title) => Promise<Exit|void>` so Next can pass a server action.
- `src/e2e`: `TaskBoardPage` (Playwright `Page` wrapper: `signIn(name)`, `gotoList()`,
  `gotoTask(id)`, `createTask(title)`, `toggle(title)`, `loadMore()`, `expectAlert(text)`),
  `failOnConsoleErrors(page)`, `resetData(baseURL)` (POSTs `testing.reset` over HTTP with the
  test header), and `sharedScenarios(test, options)` registering scenarios 1–6 of the spec.

- [ ] **Step 1: Write `test/server.test.ts`** (Vitest via `testCaller`): `reset is a defect without
  EXAMPLES_TEST`; `guest create → Forbidden`; `empty title → ValidationFailed`; `no session →
  Unauthorized`; `list pages by 5 with nextCursor`; `toggle publishes onChanged`; `byId 999 →
  TaskNotFound`.
- [ ] **Step 2:** Run → FAIL (no module).
- [ ] **Step 3:** Implement domain, store (`Ref` + `PubSub`), server layer, UI, page objects.
- [ ] **Step 4:** `pnpm exec vp -C examples/shared test` PASS; `pnpm check` 0 warnings.
- [ ] **Step 5: Commit** `feat(examples): shared task-board domain, UI and page objects`.

### Task 3: Next.js example

**Files:** `examples/next/{package.json,next.config.ts,tsconfig.json,playwright.config.ts}`,
`app/layout.tsx`, `app/page.tsx` (list, RSC prefetch), `app/tasks/[id]/page.tsx`,
`app/sign-in/route.ts` (sets cookie), `app/api/rpc/[[...rpc]]/route.ts`, `app/actions.ts`
(server actions via `createServerActionCaller`), `trpc/client.tsx`, `trpc/server.tsx`,
`e2e/shared.spec.ts`, `e2e/next.spec.ts`.

- [ ] **Step 1: Tests first.** `shared.spec.ts` = `sharedScenarios(test, …)`. `next.spec.ts`:
      `SSR HTML contains task titles and "Signed in as ada" (request with JS disabled)`;
      `task page hydrates to a class: "Overdue" visible after hydration`;
      `server action as guest shows "Forbidden: guests cannot write"`;
      `GET /api/rpc → 405 with Allow: POST`.
- [ ] **Step 2:** `example:build` fails (no app) → RED.
- [ ] **Step 3:** Implement the app the way the Next.js guide shows (`createRouteHandler`,
      `createNextRpcClient`, `createRscHelpers` with `headers: () => headers()`, `HydrateClient`,
      `useServerAction`). `resolveUser = cookieUser`.
- [ ] **Step 4:** `pnpm -C examples/next example:test` (builds, `next start` via Playwright
      `webServer` with `EXAMPLES_TEST=1`) → all PASS. Fix library bugs per Global Constraints.
- [ ] **Step 5: Commit** `feat(examples): Next.js app with Playwright suite`.

### Task 4: TanStack Start example

**Files:** `examples/start/{package.json,vite.config.ts,tsconfig.json,playwright.config.ts}`,
`src/router.tsx`, `src/routes/__root.tsx`, `src/routes/index.tsx` (list, loader),
`src/routes/tasks.$id.tsx` (loader with `prefetchQuery`, typed error), `src/routes/api/rpc.$.ts`,
`src/routes/sign-in.ts` (server route setting the cookie), `src/rpc/client.ts`
(`createIsomorphicFn` split), `e2e/shared.spec.ts`, `e2e/start.spec.ts`.

- [ ] **Step 1: Tests first.** `start.spec.ts`: `SSR HTML for /tasks/1 contains the title (JS
  disabled)`; `SSR of /tasks/999 shows "Task #999 not found" after hydration (typed error survived)`;
      `client navigation from list to task issues POST /api/rpc` (Playwright request listener);
      `SSR shows "Signed in as ada"`.
- [ ] **Step 2:** RED (no app).
- [ ] **Step 3:** Implement per the Start guide (`createStartHandler`, `createStartHelpers`,
      `hydration.routerOptions`, loaders awaiting `ensureQueryData` / `prefetchQuery`). The server half
      forwards the request cookie to `createServerClient` headers.
- [ ] **Step 4:** `pnpm -C examples/start example:test` → PASS.
- [ ] **Step 5: Commit** `feat(examples): TanStack Start app with Playwright suite`.

### Task 5: Electron example

**Files:** `examples/electron/{package.json,tsconfig.json,playwright.config.ts}`, `src/main.ts`
(`MainRpcServer.run`, two windows ada/guest, `resolveUser` maps `MainRpcServer.senderId(headers)`
→ user by window), `src/preload.ts`, `src/renderer/{index.html,main.tsx}`, build config
(bundle main/preload/renderer), `e2e/shared.spec.ts`, `e2e/electron.spec.ts`.

- [ ] **Step 1: Tests first.** Shared scenarios on window 1 (sign-in = choosing the window's user;
      scenario 5 uses both windows). `electron.spec.ts`: `two windows see different users`;
      `preload exposes nothing` (`window.ipcRenderer`, `window.require` undefined);
      `closing a window ends its subscription, the other keeps receiving`.
- [ ] **Step 2:** RED.
- [ ] **Step 3:** Implement per the Electron guide; `contextIsolation: true`, `sandbox: true`.
      `EXAMPLES_TEST=1` passed via Playwright `_electron.launch({ env })`.
- [ ] **Step 4:** `pnpm -C examples/electron example:test` → PASS.
- [ ] **Step 5: Commit** `feat(examples): Electron app with Playwright suite`.

### Task 6: CI, scripts, docs

**Files:** `.github/workflows/examples.yml`, root `package.json` (`examples:test`),
`examples/README.md` + one README per app, `packages/e2e/README.md` (no longer "not exercised"),
`site/guide/frameworks/{next,start,electron}.md` ("Full example" link),
`site/guide/advanced/limits.md` ("Not covered by tests" section updated).

- [ ] **Step 1:** Workflow: `on: pull_request, push: main`; matrix `[next, start, electron]`;
      checkout, pnpm, node 24, `pnpm install --frozen-lockfile`, `pnpm exec vp run -r build`,
      `pnpm exec playwright install --with-deps chromium` (not for electron), run
      `pnpm -C examples/${{ matrix.app }} example:test` (electron: `xvfb-run -a`), upload
      `playwright-report` on failure. Concurrency cancels superseded PR runs.
- [ ] **Step 2:** Docs updates; `pnpm docs:build` + `pnpm -C site docs:test` pass (dead links, anchors).
- [ ] **Step 3:** Full gates: `pnpm ready`, `pnpm examples:test`. Commit
      `ci: run framework examples in real browsers`.
- [ ] **Step 4:** Final whole-branch review, fixes, push, open PR (base `t3code/lint-zero`), watch
      checks.
