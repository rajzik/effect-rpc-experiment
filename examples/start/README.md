# TanStack Start example

The task board on TanStack Start (Vite+) with `@rpc-effect/start`. The session is an httpOnly
`session` cookie set by `/sign-in?user=<name>`.

## What it demonstrates

- **Server route**: `src/routes/api/rpc.$.ts` serves the router (`createStartHandler`).
- **Isomorphic client**: `src/rpc/client.ts` runs in-process during SSR (with the request's cookie)
  and over `/api/rpc` in the browser.
- **Loader prefetch + hydration**: `src/routes/index.tsx` and `src/routes/tasks.$id.tsx` prefetch in
  the loader, so the server-rendered HTML already contains the data; the dehydrated query cache
  keeps the typed `TaskNotFound` for `/tasks/999`.
- **Shared components**: the routes render `@rpc-effect-examples/shared/ui`.

## Files worth reading

`src/rpc/client.ts`, `src/rpc/server.ts` (not `src/server.ts`: Start treats that as its server
entry), `src/routes/__root.tsx`, `src/routes/index.tsx`, `vite.config.ts`, `e2e/start.spec.ts`.
`src/routeTree.gen.ts` is generated on every build and committed; lint and format ignore it.

## Run

```sh
pnpm -C examples/start example:build   # vp build (client + SSR)
pnpm -C examples/start example:start   # vp preview on :3100
pnpm -C examples/start example:test    # builds, serves and tests (Playwright webServer)
```

Start has no standalone Node server without an extra dependency, so the built output is served by
`vp preview`; a real deployment target may behave differently. The suite pins that a subscription
update still arrives while the stream is open.
