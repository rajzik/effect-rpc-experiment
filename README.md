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
TypeScript 7 (`tsgo`) for type-checking, Oxlint (type-aware via tsgolint) for linting and Oxfmt for
formatting. Package manager: pnpm (see `packageManager` in `package.json`); Node ≥ 22.18.

```bash
pnpm install                 # install (honours pnpm-workspace.yaml catalog + overrides)
pnpm exec vp check           # format + lint + type-check (Oxfmt, Oxlint, tsgolint)
pnpm exec vp check --fix     # fix formatting and autofixable lint
pnpm exec vp run typecheck   # tsgo --build across all packages (project references)
pnpm exec vp run -r test     # Vitest 5 in every package (runtime + type tests)
pnpm exec vp -C packages/core test   # one package
pnpm exec vp run -r build    # vp pack (tsdown) every package → dist/
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
scripts/verify-*.mjs  # verification oracles used by the acceptance gates
docs/                 # tRPC test inventory and parity table
```

### Conventions

- Effect v4 APIs only (`effect`, `effect/rpc`, `effect/http`, `effect/schema`). Check
  `node_modules/effect/dist/**/*.d.ts` before using an API from memory — v3 docs are frequently wrong
  for v4.
- Typed errors are `Schema.TaggedError` classes; discriminate on `_tag` (never `instanceof` across
  serialization boundaries).
- `RpcServer.layerHttp` is always configured with `protocol: "http"` and `disableFatalDefects: true`.
- No new production dependencies without discussion; use the catalog in `pnpm-workspace.yaml`.
