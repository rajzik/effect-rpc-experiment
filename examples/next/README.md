# Next.js example

The task board on Next.js (App Router) with `@rpc-effect/next`. The session is an httpOnly
`session` cookie set by `/sign-in?user=<name>`.

## What it demonstrates

- **Route handler**: `app/api/rpc/[[...rpc]]/route.ts` serves the router over HTTP (the browser's
  `httpLink` talks to it).
- **RSC prefetch + hydration**: `trpc/server.tsx` builds `createRscHelpers` with the request's
  `headers()`, so the cookie reaches the `Auth` middleware in-process; `app/page.tsx` awaits the
  prefetch and `HydrateClient` hands the cache to the browser.
- **Server action**: `app/actions.ts` wraps `createServerActionCaller`; `app/board.tsx` submits new
  tasks through it with `useServerAction`, and a guest gets the typed `Forbidden` back.
- **Shared components**: `app/board.tsx` and `app/tasks/[id]/page.tsx` render
  `@rpc-effect-examples/shared/ui`.

## Files worth reading

`trpc/server.tsx`, `trpc/client.tsx`, `app/page.tsx`, `app/actions.ts`,
`app/api/rpc/[[...rpc]]/route.ts`, `server.ts` (the cookie-backed handlers), `e2e/next.spec.ts`.

## Run

```sh
pnpm -C examples/next example:build   # next build
pnpm -C examples/next example:start   # next start on :3200
pnpm -C examples/next example:test    # builds, starts and tests (Playwright webServer)
```

The suite sets `EXAMPLES_TEST=1` on the server. It adds Next-specific tests: SSR HTML with
JavaScript disabled, the cookie route, hydration to a class instance, the server action as a guest,
and `GET /api/rpc` returning 405.
