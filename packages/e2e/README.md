# @effect-trpc/e2e

Private end-to-end tests that run the published packages together, the way an app uses them. The
package has no `src/` and is never published. It imports `@effect-trpc/*` through their package
entries (`dist/`), not through source paths, so it also checks that the built packages fit
together.

## What the suite proves

`test/full-stack.test.tsx` (jsdom) wires core → server (a real Node HTTP server from
`@effect-trpc/test-utils`' `testServerAndClient`) → `@effect-trpc/client` over HTTP →
`@effect-trpc/tanstack-react-query` (`createRpcContext`, `createRpcOptionsProxy`,
`createHydrationHelpers`) → a React component rendered with `@testing-library/react`. It checks
that:

- a `Schema.Class` instance fetched over HTTP renders as a real instance (`greet()` callable,
  `createdAt` restored to a `Date`, `instanceof User`);
- a typed `Schema.TaggedError` arrives as the query error, is narrowed by `_tag` in the component,
  and the error type is exactly `ClientError<NotFound>` (checked with `expectTypeOf`);
- a handler defect surfaces as `RpcDefect`, never as `RpcTransportError`, `RpcInterrupted` or a
  domain error;
- `dehydrate` produces a JSON-safe payload (survives `JSON.parse(JSON.stringify(...))`), and
  `HydrationBoundary` / `hydrate` restore `User` instances and `NotFound` errors in a fresh
  `QueryClient` (the success query renders without refetching; the error query is refetched on
  mount by TanStack and shows the typed error again).

`test/fixtures.ts` holds the router and handlers the suite runs against.

Electron, Next.js and TanStack Start are listed as dev dependencies but are not exercised here yet;
their behaviour is covered by each package's own tests.

## Run it

The tests resolve the packages through their `dist/` builds, so build first:

```sh
pnpm exec vp run -r build
pnpm exec vp -C packages/e2e test
```

`vp test` runs the runtime tests (`test/**/*.test.ts(x)`) and type tests
(`test/**/*.test-d.ts(x)`) as configured in `vite.config.ts`. After changing a package's `src/`,
rebuild it (`pnpm exec vp -C packages/<name> pack`) before re-running the suite, or the tests run
against the stale build.

## For AI agents

**Add an e2e test when** the claim spans several packages and only holds once they are composed,
for example a value crossing server → HTTP → client → TanStack Query → React, or SSR dehydration
followed by client hydration. **Add a package test instead** when one package's behaviour is the
subject (a link, an adapter, a codec, a hook): it is faster, needs no build, and belongs in that
package's `test/PARITY.md`.

**Fixtures**

- `test/fixtures.ts` is self-contained: a `User` `Schema.Class` (with a `greet()` method and a
  `Schema.Date` field, so instance and `Date` restoration are observable), a `NotFound`
  `Schema.TaggedError`, a fixed `createdAt`, and `appRouter` with `health`, `user.byId`,
  `user.create`, `user.list` (subscription) and `boom` (always dies).
- `HandlersLive` (`Handlers.make`) implements every procedure: `user.byId({ id: 'ghost' })` fails
  with `NotFound`, any other id returns a `User` named `Ada`; `boom` dies with `kaboom`.
- The fixture is copied, not imported from another package's tests, so the e2e suite owns its
  inputs. Extend it here when a new scenario needs another procedure.
- One server per `describe` (`testServerAndClient` in `beforeAll`, `ctx.dispose()` in
  `afterAll`), a new `QueryClient` per test with `retry: false`, and `cleanup()` after each test.

**Invariants**

- Import only public package entries (`@effect-trpc/<name>`), never `../<name>/src`; the suite
  tests the built output.
- React test files start with `// @vitest-environment jsdom` and import test APIs from
  `vite-plus/test`.
- Client errors are `ClientError<E> = E | RpcDefect | RpcTransportError | RpcInterrupted`; assert
  the class (`toBeInstanceOf`) and, for type claims, the exact type with `expectTypeOf`.
- Every test disposes what it starts (the HTTP server via `ctx.dispose()`, rendered trees via
  `cleanup()`).
- Do not edit `package.json`, `tsconfig.json` or `vite.config.ts` here unless you own the
  toolchain; report needed changes instead.
