# Agent guide for effect-trpc

This monorepo is a tRPC-style typed RPC layer for Effect v4 plus a TanStack React Query bridge and
framework adapters. Read `README.md` for bootstrap and the package map, then the `## For AI agents`
section of each package you touch. For a task with an approved design or plan in
`docs/superpowers/`, read the relevant document; keep shared contracts in tracked files.

Before choosing tests or handing back code changes, read
[the verification skill](.agents/skills/verify-effect-trpc/SKILL.md).

## Toolchain (Vite+, tsgo, Oxlint)

Always run commands through the project-local Vite+ CLI from the repository root
(`pnpm exec vp ...`, or `node_modules/.bin/vp ...`). Never install node/pnpm/tooling via Homebrew.

| Task                                                | Command                                      |
| --------------------------------------------------- | -------------------------------------------- |
| format + lint (incl. Effect rules) + type-check     | `pnpm check` (`pnpm check --fix` to autofix) |
| type-check only (TypeScript 7 / tsgo project build) | `pnpm exec vp run typecheck`                 |
| test one package (runtime + type tests)             | `pnpm exec vp -C packages/<name> test`       |
| test everything                                     | `pnpm exec vp run -r test`                   |
| build all packages                                  | `pnpm exec vp run -r build`                  |
| JSDoc contract + type-check examples (after build)  | `node scripts/verify-jsdoc.mjs [<name>...]`  |

Build the workspace before checks on a fresh checkout: package exports resolve through `dist/`.
`pnpm ready` runs the full CI sequence with the build first.

`vp test` is a built-in (Vitest 5). Import test APIs from `vite-plus/test` (or `@effect/vitest` for
`it.effect`). React tests need `// @vitest-environment jsdom` at the top of the file. Type tests
live in `test/**/*.test-d.ts(x)` and run as part of `vp test`.

Lint runs Oxlint with the Effect rules (`effecttsgo/*`, recommended preset of
[`@effect/tsgo`](https://github.com/Effect-TS/tsgo)). Those rules need the Effect-patched Oxlint
binding, so always lint through the wrapper: `pnpm check` / `pnpm lint` (= `effect-tsgo vp check` /
`effect-tsgo vp lint`). Plain `vp check` / `vp lint` fail with `Unknown plugin: 'effecttsgo'`.
Keep `vite-plus` on a release whose bundled `oxlint` / `oxlint-tsgolint` versions `@effect/tsgo`
supports (see its README) and bump both together.

Warnings fail the lint (`--deny-warnings`). Fix the code; when a flagged construct is intentional
(proxy type erasure), disable that one line with a reason:
`// oxlint-disable-next-line <rule> -- <why it is sound>`. No file-wide disables.

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
- Docs: every public export has Effect-style JSDoc (summary, **When to use**, **Details**,
  **Gotchas**, a compiling **Example**, `@category`, `@since`) per `docs/jsdoc-style.md`; every
  `src/` file opens with a module header. Each package README has a `## For AI agents` section
  (entry points, golden path, invariants, common mistakes, verify commands): update it with the API.
- Errors: `Schema.TaggedError` classes, discriminated by `_tag`. The client error union is
  `ClientError<E> = E | RpcDefect | RpcTransportError | RpcInterrupted` (from `@rpc-effect/core`).
- Tests prove behaviour through the public API; every typed-error claim has a `.test-d.ts` check.
- Each package keeps `test/PARITY.md` mapping ported tRPC test files (see
  `docs/trpc-test-inventory.txt`) to local tests.
- Do not edit `package.json`, `tsconfig.json` or `vite.config.ts` of a package you are implementing
  unless you own the toolchain; report needed changes instead.

## Review checklist

- [ ] Verification scope selected and commands passed per the verification skill.
- [ ] Changed API documented in JSDoc and the package README, including `## For AI agents`.
- [ ] `test/PARITY.md` updated when adding or changing ported tRPC coverage.
- [ ] Handback states what changed, commands run, and any failures or checks not run.
