# Framework examples with real-browser tests — design

Date: 2026-11-05 · Status: approved 2026-11-05

## Intent

Prove that effect-trpc works inside the real frameworks it supports, not only in unit tests with Web
`Request`s and jsdom (today's known limit). Each supported framework gets a realistic example app,
built for production and driven in a real browser (or a real Electron window) by Playwright. The
apps double as reference implementations readers can study.

## Goals

1. Three example apps — Next.js App Router, TanStack Start, Electron — sharing one realistic domain.
2. One Playwright suite per app, run against the **production build** (`next build && next start`,
   Start's built server, Electron launched from built files), covering the same user-visible
   scenarios across apps plus each framework's specifics.
3. Run in CI on every PR, so a library change that breaks a framework integration fails its PR.

## Non-goals

- Starter templates meant to be copied out unchanged (apps import the shared domain).
- Styling beyond plain readable HTML; deployment of the example apps.
- Packaging Electron installers (electron-builder etc.); Playwright launches the built app directly.
- Testing every browser: Chromium only.

## Anti-goals

- Tests that pass without exercising the framework (e.g. calling handlers directly, mocking fetch,
  or dev-server-only runs).
- Flaky tests: no fixed sleeps; wait on visible state.
- Breaking or slowing the existing `ci.yml` job or `pnpm ready`.

## Constraints

- Workspace glob `examples/*` already exists; apps use `workspace:*` packages through their built
  `dist` (like `packages/e2e`), so the tests also prove the built packages work.
- Toolchain: pnpm 11 workspace, `vite` overridden to the Vite+ core; Effect v4; lint with
  `--deny-warnings` (examples must pass `pnpm check`).
- New dev dependencies (approving this doc approves them): `@playwright/test`; per app the framework
  deps from the catalog (`next`, `@tanstack/react-start`, `@tanstack/react-router`,
  `@tanstack/react-query`, `react`, `react-dom`, `electron`), plus `@tanstack/router-plugin` if Start
  needs it and a bundler for the Electron main/preload/renderer (prefer the Vite+ `vp pack`/Vite
  already in the workspace). Anything else is asked first.
- `allowBuilds: electron: true` is needed so the Electron binary downloads on install (~100 MB,
  every install including CI's main job). Alternative if unacceptable: install Electron only in the
  examples workflow (decided in the spike, reported).
- TanStack Start's Vite plugin must run on the Vite+ core (`vite` override). Unknown; spiked first.

## Approaches (decided)

| Approach                                                                         | Outcome                                                     |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Shared domain package + three thin framework apps, same scenarios tested in each | **Picked**                                                  |
| Three fully self-contained apps                                                  | Rejected: three copies drift; every library change fixed 3× |
| Extend `packages/e2e` with harnesses                                             | Rejected: not "real world", unreadable as an example        |

Testing: Playwright against production builds (user's choice) over build + HTTP checks.

## Design

### Layout

```
examples/
  shared/        # @effect-trpc-examples/shared — router, handlers, auth middleware, seed data,
                 #   Playwright scenario helpers (page objects) reused by the three suites
  next/          # Next.js App Router app + e2e/*.spec.ts
  start/         # TanStack Start app + e2e/*.spec.ts
  electron/      # Electron app (main / preload / renderer) + e2e/*.spec.ts
```

Each example is a private workspace package with scripts `build`, `start` (production server or
built app), `test:e2e` (Playwright). Not picked up by `vp run -r build/test` — scripts prefixed
`example:` (as the docs site does with `docs:`), so the existing pipeline is unchanged.

### Domain: team task board

- `Task` (`Schema.Class`: id, title, done, assignee, `createdAt: Schema.Date`, `dueAt` optional,
  getter `isOverdue`), `TaskPage` for cursor pagination.
- Errors: `TaskNotFound`, `Forbidden` (guests may not write), `Unauthorized` (no session),
  `ValidationFailed` (empty title).
- `Auth` middleware reads a session (Next/Start: an httpOnly cookie set by a sign-in route or action;
  Electron: the per-window sender id mapped to a user) and provides `CurrentUser`.
- Procedures: `tasks.list` (cursor → infinite query), `tasks.byId`, `tasks.create`, `tasks.toggle`,
  `tasks.onChanged` (subscription via a `PubSub`), `session.me`.
- In-memory store per server process, resettable via a test-only procedure guarded by an env flag
  (`EXAMPLES_TEST=1`) so each test starts from known seed data.

### Scenarios (all three apps)

1. Sign in, see the task list; dates render from real `Date`s (proves class decoding).
2. Open a task; open a missing id → the page shows the `TaskNotFound` message (typed error by `_tag`).
3. Guest creates a task → `Forbidden` shown; member creates → task appears without reload.
4. Empty title → `ValidationFailed` shown.
5. Two pages/windows: toggling in one updates the other live (subscription).
6. Load more (infinite query) appends the next page.

### Framework-specific scenarios

- **Next.js:** server-rendered task page has the data in the initial HTML (RSC prefetch +
  `HydrateClient`, no loading state, class instance after hydration — e.g. `isOverdue` rendered on the
  client); create via **server action** with `useServerAction` shows `Forbidden` typed; route handler
  `GET` → 405.
- **TanStack Start:** loader with `ensureQueryData` → SSR HTML contains data; client navigation calls
  `/api/rpc`; typed error from `prefetchQuery` loader survives SSR.
- **Electron:** two windows get distinct sender ids (each window's `session.me` differs); closing a
  window ends its subscription; preload exposes nothing on `window` (`window.ipcRenderer` undefined).

### Tests and CI

- Playwright config per app: `webServer` starts the production server (Next/Start) on a free port;
  Electron uses `_electron.launch` on the built main. Chromium only, retries 0 locally, 1 in CI,
  traces on failure.
- New workflow `.github/workflows/examples.yml`: matrix `[next, start, electron]`; install, build
  packages, build the example, install Playwright Chromium, run `test:e2e` (Electron under
  `xvfb-run`). Upload Playwright reports on failure. Separate from `ci.yml`.
- Root scripts: `pnpm examples:test` runs all three locally.

### Plan order (risk first)

1. Spike TanStack Start on the Vite+ core (production build + serve). Fallback: scoped
   `vite` override for the Start example (as the docs site does for VitePress). If neither works,
   stop and report.
2. Spike Electron binary install + Playwright `_electron` launch.
3. Shared domain + Next.js app + suite (lowest risk, proves the harness).
4. Start app + suite. 5. Electron app + suite. 6. CI workflow, READMEs, docs-site links.

## Library bugs found by the examples (user decision)

Fixed in this PR: each fix is its own commit in `packages/*` with a failing unit test first
(plus `.test-d.ts` when types change), README / `test/PARITY.md` updates where relevant, and the
full `pnpm ready` gate. Example tests stay strict; no scenario is skipped or weakened to pass.

## Calls I made (to check)

- Domain is a team task board with cookie sessions (Next/Start) and window-mapped users (Electron).
- Test-only reset procedure behind `EXAMPLES_TEST=1`, never enabled in a normal build.
- `example:`-prefixed scripts and a separate workflow; existing pipeline untouched.
- Chromium only; Electron not packaged.
- Delivered as a new PR stacked on #4.

## Left to the builder

Exact page layouts and copy, selectors (prefer accessible roles/labels), port numbers, how sessions
are represented, seed data contents.
