# Examples

Three small apps that run the same task board through the framework adapters, each tested in a
real browser (or a real Electron window) against its **production build**. They are the proof that
`@effect-trpc/next`, `@effect-trpc/start` and `@effect-trpc/electron` work inside running apps, not
only in unit tests. Nothing here is published.

| App                      | Adapter                 | Shows                                                                                                                         |
| ------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [`next`](./next)         | `@effect-trpc/next`     | route handler, RSC prefetch + hydration, server action, cookie session through all of them                                    |
| [`start`](./start)       | `@effect-trpc/start`    | server route, isomorphic client, SSR loader prefetch + hydration, cookie session                                              |
| [`electron`](./electron) | `@effect-trpc/electron` | server in the main process, `MessagePort` per window, one window per user (identified by `webContents.id`), sandboxed preload |
| [`shared`](./shared)     | (none)                  | the task board itself: domain, handlers, UI, and the Playwright helpers the three suites share                                |

## The task board

A list of tasks with `Load more`, a task page, a "new task" form and a live feed. It exercises:

- a `Schema.Class` (`Task`, with a `Date` and an `isOverdue` getter), so a page that renders
  `Overdue` proves the value arrived as a class instance, not as plain JSON;
- typed errors (`TaskNotFound`, `Forbidden`, `ValidationFailed`) narrowed by `_tag` in the UI;
- an `Auth` middleware (guests may read, not write) fed by a cookie (web) or the sending window
  (Electron);
- an infinite query, mutations, and a subscription (`tasks.onChanged`) that must reach the page
  while the stream stays open.

Users are `ada` and `grace` (members) and `guest`. The data is in memory.

## Run

From the repository root (build the packages first: `pnpm exec vp run -r build`). Every app has the
same scripts:

```sh
pnpm -C examples/<app> example:build   # production build
pnpm -C examples/<app> example:start   # serve / launch the build (next: :3200, start: :3100)
pnpm -C examples/<app> example:test    # Playwright suite (builds first)
pnpm examples:test                     # all three suites, one after the other
```

`example:test` for `next` and `start` builds and serves the app through Playwright's `webServer`;
for `electron` it builds, then launches the built files with Playwright's `_electron`. The first
Electron launch may download the Electron binary (`pnpm -C examples/electron exec install-electron`
fetches it up front). Chromium for the web suites: `pnpm exec playwright install chromium`.

The scripts are prefixed `example:` on purpose: `pnpm ready`, `vp run -r build` and `ci.yml` do not
touch the apps. They run in [`.github/workflows/examples.yml`](../.github/workflows/examples.yml),
one job per app.

## How `shared` is organised

`@effect-trpc-examples/shared` is consumed from source (no build):

| Entry                                 | Contents                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `@effect-trpc-examples/shared`        | `appRouter`, `Task`, `User`, the typed errors and the `Auth` middleware declaration (safe for browsers)    |
| `@effect-trpc-examples/shared/server` | `makeServerLive({ resolveUser })` (handlers + `Auth`), `cookieUser`, the in-memory store                   |
| `@effect-trpc-examples/shared/ui`     | the React components (`TaskList`, `TaskDetail`, `NewTaskForm`, `LiveFeed`, `SignedInAs`) and query options |
| `@effect-trpc-examples/shared/e2e`    | `sharedScenarios`, the `TaskBoardPage` page object, `httpBoards`, `failOnConsoleErrors`, `resetData`       |

An app only decides how a request names its user (`resolveUser`), how it wires the adapter, and how
its routes render the shared components. `examples/shared` has its own Vitest tests (`pnpm -C
examples/shared test`), which `vp run -r test` and `ci.yml` already run.

## How the tests work

- **One set of scenarios.** `sharedScenarios` registers seven user-visible scenarios (list with real
  dates, typed not-found, guest `Forbidden` vs member create, validation error, live update across
  two windows within 5 seconds, load more, isolation between tests) on each app's Playwright `test`.
  Each app adds tests for what only it can show: SSR HTML with JavaScript disabled, the dehydrated
  `TaskNotFound` in Start's payload, the 405 on `GET /api/rpc`, Electron's preload exposing nothing,
  and windows ending their subscriptions when closed.
- **Production builds.** The suites never run a dev server. Next uses `next start`; Start uses `vp
  preview` over the built output (Start has no standalone Node server without an extra dependency,
  so `vp preview` stands in for one); Electron runs the bundled `dist/`.
- **Failures you cannot miss.** Every page is guarded by `failOnConsoleErrors`: a `pageerror` or a
  `console.error` (a hydration mismatch, an uncaught error) fails the test at teardown.
- **Isolation.** `EXAMPLES_TEST=1` enables the test-only `testing.reset` procedure (it dies
  otherwise); every test resets the data first. One worker per app, Chromium only, one retry in CI,
  traces kept on failure.
