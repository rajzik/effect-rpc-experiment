# effect-trpc

A tRPC-style, end-to-end type-safe RPC layer for [Effect](https://effect.website) v4, with a
first-class bridge to [TanStack React Query](https://tanstack.com/query) and adapters for Next.js,
TanStack Start and Electron.

- **Typed errors and return types everywhere.** A procedure's success schema and `Schema.TaggedError`
  union flow from the server handler to the Promise/Effect client and into TanStack Query's `TError`.
  Infrastructure failures (defects, transport, interruption) are typed separately — never disguised
  as your domain errors.
- **Automatic (de)serialization with Effect Schema.** `Schema.Class` instances and schema errors
  cross the wire (and SSR hydration) and arrive as real class instances.
- **Built on `effect/rpc`**, not a reimplementation: `RpcGroup`, `RpcServer`, `RpcClient`,
  `RpcMiddleware` and `RpcSerialization` do the heavy lifting.

## Documentation

The reference site lives in [`site/`](site/) and is published to GitHub Pages
(<https://rajzik.github.io/effect-rpc-experiment/>) and Vercel (`vercel.json`): guides for every package, framework setups,
advanced recipes, and an API reference generated from the JSDoc. Run it locally with
`pnpm docs:dev` (after `pnpm exec vp run -r build`).

## For AI agents

Start here, then read the `## For AI agents` section of the package you are touching. Every public
export carries Effect-style JSDoc (summary, **When to use**, **Details**, **Gotchas**, a
type-checked **Example**, `@category`, `@since`): hover it, or read it in `packages/<name>/src`.

**Pick the package by job**

| You need to…                                              | Use                                                        |
| --------------------------------------------------------- | ---------------------------------------------------------- |
| Declare procedures and a router (shared by server+client) | `@effect-trpc/core`                                        |
| Implement handlers and serve them (Node, fetch, caller)   | `@effect-trpc/server` (`/node` for a Node listener)        |
| Call procedures from TS (Promise or Effect)               | `@effect-trpc/client`                                      |
| Use procedures in React with TanStack Query               | `@effect-trpc/tanstack-react-query`                        |
| Wire it into Next.js App Router / RSC / server actions    | `@effect-trpc/next`                                        |
| Wire it into TanStack Start (server route + loaders)      | `@effect-trpc/start`                                       |
| Run the server in Electron main, call it from a renderer  | `@effect-trpc/electron` (`/main`, `/preload`, `/renderer`) |
| Write tests against a real server                         | `@effect-trpc/test-utils`                                  |

**Golden path:** `Router.make({...})` in a shared module (core) → `Handlers.make(router, {...})` and
`toWebHandler` / `serve` (server) → `createClient(router, { link: httpLink({ url }) })` (client) →
`createRpcOptionsProxy` + `useQuery(rpc.x.queryOptions(input))` (tanstack-react-query) → the
framework adapter for your app.

**Invariants**

- Effect v4 only (`Context.Service`, `yield* Service`, `effect/rpc`, `effect/http`). Verify APIs in
  `node_modules/effect/dist/**/*.d.ts`; v3 snippets from memory are usually wrong.
- Domain data is `Schema.Class`, typed errors are `Schema.TaggedError`; narrow on `_tag`.
- Client-side errors are `ClientError<E> = E | RpcDefect | RpcTransportError | RpcInterrupted`.
- Cross a JSON boundary (SSR, server actions, caches) only through the provided codecs /
  `dehydrate` / `hydrate`, or class instances are lost.
- Servers built on `RpcServer.layerHttp` use `protocol: "http"` and `disableFatalDefects: true`;
  client URLs are absolute.

**Before you hand work back:** `pnpm check`, `pnpm exec vp run typecheck`,
`pnpm exec vp -C packages/<name> test`, `pnpm exec vp run -r build`, `pnpm docs:check`. New or
changed exports follow [`docs/jsdoc-style.md`](docs/jsdoc-style.md).

## Packages

| Package                             | Purpose                                                                                                                                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@effect-trpc/core`                 | Router/procedure definitions (`query`, `mutation`, `subscription`, `Router.make`), the client error model, JSON codecs                                                                                     |
| `@effect-trpc/server`               | Handler layers, HTTP / fetch `Request → Response` adapters, in-process caller, middleware                                                                                                                  |
| `@effect-trpc/client`               | `createClient` + links (`httpLink`, `wsLink`, `localLink`): Promise and Effect clients                                                                                                                     |
| `@effect-trpc/tanstack-react-query` | Options proxy modeled on `@trpc/tanstack-react-query`: `queryOptions`, `infiniteQueryOptions`, `mutationOptions`, `subscriptionOptions`, keys/filters, provider, `useSubscription`, Schema-aware hydration |
| `@effect-trpc/next`                 | Next.js App Router route handler, RSC prefetch + `HydrateClient`, server-action caller                                                                                                                     |
| `@effect-trpc/start`                | TanStack Start server route handler, isomorphic client, loader helpers                                                                                                                                     |
| `@effect-trpc/electron`             | Main-process server and renderer link over `MessagePort`, preload bridge                                                                                                                                   |
| `@effect-trpc/test-utils`           | Shared test harness (real Node HTTP server + clients)                                                                                                                                                      |

## Toolchain

This repository uses [Vite+](https://viteplus.dev) (`vp`) as the single toolchain entry point,
TypeScript 7 (`tsgo`) for type-checking, Oxlint (type-aware via tsgolint, plus the Effect rules of
[`@effect/tsgo`](https://github.com/Effect-TS/tsgo)) for linting and Oxfmt for formatting. `pnpm check`
runs `effect-tsgo vp check`, which loads the Effect-patched Oxlint binding; plain `vp check` cannot
load the `effecttsgo` plugin. Package manager: pnpm (see `packageManager` in `package.json`); Node ≥ 22.18.

```bash
pnpm install                 # install (honours pnpm-workspace.yaml catalog + overrides)
pnpm check                   # format + lint + type-check (Oxfmt, Oxlint + Effect rules, tsgolint)
pnpm check --fix             # fix formatting and autofixable lint
pnpm exec vp run typecheck   # tsgo --build across all packages (project references)
pnpm exec vp run -r test     # Vitest 5 in every package (runtime + type tests)
pnpm exec vp -C packages/core test   # one package
pnpm exec vp run -r build    # vp pack (tsdown) every package → dist/
pnpm docs:check              # JSDoc contract + type-check every @example (after build)
pnpm docs:dev                # the documentation site (site/), with the generated API reference
pnpm docs:build              # build the site; fails on dead links
pnpm run ready               # everything above, in order
```

If the global `vp` CLI is installed (`curl -fsSL https://vite.plus | bash`), `vp <cmd>` delegates to
the project-local `vite-plus` version.

### Layout

```
vite.config.ts        # root: lint (Oxlint + tsgolint), fmt (Oxfmt), cached tasks — the only lint/fmt config
tsconfig.base.json    # shared strict TS options (NodeNext, verbatimModuleSyntax, exactOptionalPropertyTypes)
tsconfig.json         # solution file with project references for tsgo --build
pnpm-workspace.yaml   # workspace globs, dependency catalog, vite/vitest overrides required by Vite+
packages/<name>/
  package.json        # ESM, exports ./dist/index.mjs + ./dist/index.d.mts, build = vp pack, test = vp test
  tsconfig.json       # extends base, project references to sibling packages
  vite.config.ts      # pack entry + vitest config ONLY (lint/fmt live at the root)
  src/index.ts        # public barrel
  test/*.test.ts(x)   # runtime tests (import from 'vite-plus/test' or '@effect/vitest')
  test/*.test-d.ts    # type tests (vitest typecheck)
scripts/verify-*.mjs  # verification oracles (verify-jsdoc.mjs enforces docs/jsdoc-style.md)
docs/                 # JSDoc style guide, tRPC test inventory and parity table
```

### Conventions

- Effect v4 APIs only (`effect`, `effect/rpc`, `effect/http`, `effect/schema`). Check
  `node_modules/effect/dist/**/*.d.ts` before using an API from memory — v3 docs are frequently wrong
  for v4.
- Typed errors are `Schema.TaggedError` classes; discriminate on `_tag` (never `instanceof` across
  serialization boundaries).
- `RpcServer.layerHttp` is always configured with `protocol: "http"` and `disableFatalDefects: true`.
- No new production dependencies without discussion; use the catalog in `pnpm-workspace.yaml`.
