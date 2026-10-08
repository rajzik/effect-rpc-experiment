# Agent guide for effect-trpc

This monorepo is a tRPC-style typed RPC layer for Effect v4 plus a TanStack React Query bridge and
framework adapters. Read `README.md` for the package map and `.unlazy/effect-trpc/PLAN.md` (when
present) for the active contract.

## Toolchain (Vite+, tsgo, Oxlint)

Always run commands through the project-local Vite+ CLI from the repository root
(`pnpm exec vp ...`, or `node_modules/.bin/vp ...`). Never install node/pnpm/tooling via Homebrew.

| Task                                                | Command                                          |
| --------------------------------------------------- | ------------------------------------------------ |
| format + lint + type-check                          | `vp check` (`--fix` to autofix)                  |
| type-check only (TypeScript 7 / tsgo project build) | `vp run typecheck`                               |
| test one package (runtime + type tests)             | `vp -C packages/<name> test`                     |
| test everything                                     | `vp run -r test`                                 |
| build one package / all                             | `vp -C packages/<name> pack` / `vp run -r build` |

`vp test` is a built-in (Vitest 5). Import test APIs from `vite-plus/test` (or `@effect/vitest` for
`it.effect`). React tests need `// @vitest-environment jsdom` at the top of the file. Type tests
live in `test/**/*.test-d.ts(x)` and run as part of `vp test`.

Lint and format configuration live ONLY in the root `vite.config.ts`. Package `vite.config.ts`
files configure `pack` and `test`. Do not add `.oxlintrc.json`, `vitest.config.ts` or
`tsdown.config.ts`.

## Effect v4 facts that differ from v3 (verified against effect@4.0.1)

- Imports: `import { Rpc, RpcGroup, RpcServer, RpcClient, RpcSerialization, RpcMiddleware, RpcTest } from 'effect/rpc'`;
  `import { HttpRouter, HttpServer, FetchHttpClient, HttpClient } from 'effect/http'`;
  `import { NodeHttpServer } from '@effect/platform-node'`.
- `Schema.Class<Self>("Id")({ fields })`, `Schema.TaggedError<Self>()("Tag", { fields })`,
  `Schema.toCodecJson(schema)` for JSON-safe codecs, `Schema.Exit(value, error, defect)`,
  `Rpc.exitSchema(rpc)`.
- Services: `class Svc extends Context.Service<Svc, Shape>()("Svc") {}`; read with `yield* Svc`.
  Annotation keys: `Context.Reference`. `Context.get(rpc.annotations, Key)`.
- `RpcServer.layerHttp({ group, path, protocol: "http", disableFatalDefects: true })` — both options
  are required for tRPC-like semantics (default protocol is websocket; defects are fatal otherwise).
- `HttpRouter.serve(layer)` / `HttpRouter.toWebHandler(layer)` compose RPC layers into a server or a
  fetch handler. The client's `RpcClient.layerProtocolHttp({ url })` needs an absolute URL.
- `Effect.runPromiseExit(effect, { signal })` maps AbortSignal to interruption.

When unsure, grep `node_modules/effect/dist/**/*.d.ts` — do not trust memory of v3 APIs.

## Conventions

- Public API: `const` arrow exports, `readonly` types, barrel `src/index.ts`, README per package.
- Errors: `Schema.TaggedError` classes, discriminated by `_tag`. The client error union is
  `ClientError<E> = E | RpcDefect | RpcTransportError | RpcInterrupted` (from `@effect-trpc/core`).
- Tests prove behaviour through the public API; every typed-error claim has a `.test-d.ts` check.
- Each package keeps `test/PARITY.md` mapping ported tRPC test files (see
  `docs/trpc-test-inventory.txt`) to local tests.
- Do not edit `package.json`, `tsconfig.json` or `vite.config.ts` of a package you are implementing
  unless you own the toolchain; report needed changes instead.

## Review checklist

- [ ] `vp check` passes (format, lint, type-check)
- [ ] `vp run typecheck` passes
- [ ] `vp -C packages/<name> test` passes with no type errors
- [ ] `vp -C packages/<name> pack` builds
- [ ] README and `test/PARITY.md` updated
