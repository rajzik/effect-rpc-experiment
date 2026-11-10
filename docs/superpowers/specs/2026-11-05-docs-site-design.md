# effect-trpc documentation site — design

Date: 2026-11-05 · Status: draft for approval

## Intent

A documentation website for effect-trpc that serves as **the reference for people already building
with it**. Readers know Effect and know why they picked this library; they come to the site to look
up how to do a specific job (set up a server, handle an error, prefetch in RSC, test a procedure),
copy working code, and learn the gotchas. Today that knowledge is spread over nine package READMEs
(~2,400 lines), JSDoc on every export (125 type-checked examples) and test files.

The site should look like [effect.website](https://effect.website) (source:
[Effect-TS/website](https://github.com/Effect-TS/website)), so it feels like part of the Effect
ecosystem.

## Goals

1. Cover every use case the packages support, organised by job, with complete code per page.
2. Cover advanced usage: middleware and auth context, the error model end to end, Effect vs Promise
   clients, cancellation, subscriptions over WebSocket, sharing one `QueryClient` between routers
   (`keyPrefix`), in-process callers, custom links, serialization formats, testing, Electron
   security, known limits.
3. A full API reference for every public export, generated from the existing JSDoc so it cannot
   drift from the code.
4. Every code sample on the site is type-checked in CI against the built packages.
5. The effect.website look: zinc neutral palette, monochrome primary, emerald focus/accent, Inter +
   JetBrains Mono, light and dark themes.

## Non-goals

- A marketing landing page or a "why Effect" tutorial. The home page is a short index into the docs.
- Versioned docs, i18n, an online playground.
- Rewriting the package READMEs. They stay; the site links to them from each package's API page.

## Anti-goals (failure even if it technically works)

- Code samples that don't compile or contradict the JSDoc.
- Copying effect.website's source, components or brand assets. The repo has no licence, and the Effect
  logo is Effect's mark. The look is recreated with our own CSS from public design facts (palette,
  fonts, type scale), and the site uses its own "effect-trpc" wordmark.
- Docs tooling that breaks the existing `pnpm check` / typecheck / test / build pipeline.

## Constraints

- Tool: **VitePress** (user's choice).
- The workspace overrides `vite` to `@voidzero-dev/vite-plus-core@1.4.0` for every package
  (`pnpm-workspace.yaml`). VitePress 1.6.4 (latest stable) depends on `vite@^5` and `shiki@^2`.
  Whether it runs on the Vite+ core is unknown, so a spike comes first (see Plan order).
- New tooling is dev-only, in a private workspace package. Approving this document approves this
  list: `vitepress`, `vue` (VitePress peer), `@fontsource/inter`, `@fontsource/jetbrains-mono`,
  optionally `@shikijs/vitepress-twoslash`, plus `workspace:*` links to the effect-trpc packages and
  the catalog versions of their peers (`react`, `next`, `@tanstack/react-start`,
  `@tanstack/react-router`, `electron` types) so snippets type-check. Anything beyond this list, or
  any change to the shared `vite` override, is asked about first.
- Lint/format config lives only in the root `vite.config.ts` (AGENTS.md). The site must pass
  `pnpm check`; generated files are ignored there.
- Effect v4 APIs only in samples (`Context.Service`, `effect/rpc`, `Schema.TaggedError`, …).

## Approaches considered

| Approach                                                           | Trade-off                                                                                    | Outcome                           |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | --------------------------------- |
| VitePress + JSDoc-generated API pages + type-checked snippet files | Vite-native, fast, built-in search; needs a spike for the Vite+ override                     | **Picked** (user chose VitePress) |
| Astro Starlight (what effect.website itself uses)                  | Closest to the real site; Astro pins its own Vite, so higher clash risk; more machinery      | Rejected                          |
| TypeDoc output + a few guides                                      | Cheapest full API list; reads as a symbol dump and loses the When to use / Gotchas structure | Rejected                          |

## Design

### Location and wiring

- New private workspace package `site/` (`@rpc-effect/site`), added to `pnpm-workspace.yaml`
  (`- site`). It is not under `packages/`, so `verify-jsdoc` and package conventions don't apply.
- Scripts are prefixed `docs:` (`docs:dev`, `docs:build` = `docs:api` → `vitepress build`,
  `docs:snippets`, `docs:api`) so the existing `vp run -r build` / `vp run -r test` / `pnpm ready`
  do not pick the site up. Root scripts `pnpm docs:dev` / `pnpm docs:build` delegate to it.
  The site's own config and scripts are still linted and formatted by `pnpm check`; generated
  `site/api/**` and `site/.vitepress/{cache,dist}` are ignored.
- Depends on the built packages via `workspace:*` so snippets type-check against `dist/*.d.mts`
  exactly like `verify-jsdoc` does.

### Look (recreated, not copied)

Custom VitePress theme extending the default theme, with CSS variables only:

- Neutrals: zinc scale (light bg `#fff`, fg zinc-900; dark bg zinc-950, fg zinc-50), borders zinc-200
  / zinc-800, muted text zinc-600 / zinc-400.
- Primary/brand: monochrome (zinc-900 in light, zinc-50 in dark) for buttons and active nav;
  emerald-500/400 for focus rings and the active sidebar marker.
- Fonts: Inter (body) and JetBrains Mono (code), weight 600 headings with -0.025em tracking,
  the same modular type scale (1.25 ratio) and 8px radius.
- Header: wordmark left, top nav (Guide · Frameworks · API · GitHub), search, theme toggle. Left
  sidebar per section, right "On this page" outline. System theme by default.
- Code blocks: a Shiki theme pair close to effect.website's (light/dark), with file-name titles.

### Page map

**Getting started**: Introduction (what it is, how it maps to tRPC and `effect/rpc`, package
map) · Installation (peer deps per package) · Quick start (one router → Node server → Promise client
→ React Query, end to end).

**Core concepts**: Routers and procedures (`query`/`mutation`/`subscription`, nesting, reserved keys,
`Router.isPath`/`childPath`) · Schemas and serialization (`Schema.Class` round trips, codecs) · The
error model (`ClientError<E>`, `RpcDefect` / `RpcTransportError` / `RpcInterrupted`, narrowing on
`_tag`, `exitToClientError`) · Type inference helpers (`inferInput`, `inferRouterOutputs`, …).

**Server**: Handlers (`Handlers.make`, services, layers) · Middleware and auth context · Serving
(`toWebHandler`, `serve` on Node, `layerHttp`/`toHttpLayer`) · Serialization formats · Streams and
subscriptions · In-process caller (`createCaller`, Promise vs Effect callers, `dispose`).

**Client**: `createClient` and the Promise client · The Effect client · Links (`httpLink`, `wsLink`,
`localLink`) · Headers, per-call options, AbortSignal and cancellation · Client middleware.

**TanStack React Query**: Provider and context (`createRpcContext`, `RpcProvider`) · Queries ·
Mutations and invalidation · Infinite queries · Subscriptions and `useSubscription` (states,
restart rules, client changes) · Keys and filters (`queryKey`, `pathKey`, `keyPrefix`) · SSR
hydration (`dehydrate`/`hydrate`, `HydrationBoundary`) · Differences from `@trpc/tanstack-react-query`.

**Frameworks**: Next.js (route handler, `makeQueryClient`, client provider, RSC helpers + prefetch +
`HydrateClient`, server actions + `useServerAction`, known limits) · TanStack Start (server route,
isomorphic client, router hydration, loaders, server functions) · Electron (main / preload /
renderer, `MessagePort`, security requirements).

**Testing**: test-utils harness (`testServerAndClient`, `withTestServer`, `testWebHandler`,
`testCaller`) · Testing with the caller and `localLink` · Type tests for error unions.

**Advanced** (recipes, each a complete worked example): Authentication with middleware end to end ·
Typed errors through SSR and server actions · Multiple routers in one app (`keyPrefix`) ·
Live data over WebSocket with connection state · Cancellation and timeouts · Defects vs domain
errors in production · Writing a custom link · Migrating from tRPC (concept mapping table) ·
Known limits (no HTTP batching yet, middleware order is last-added-first, WebSocket defaults to
`ndjson`).

**API reference**: one page per package (and per sub-entry: `server/node`, `electron/main`,
`/preload`, `/renderer`), grouped by `@category`, each export showing signature, summary, When to
use, Details, Gotchas, Example and `@since`.

### Code samples

- Every non-trivial sample lives in `site/snippets/<section>/<name>.ts(x)` and is pulled into pages
  with VitePress's `<<< @/snippets/...` import (whole file or `#region`).
- `site/tsconfig.snippets.json` type-checks all snippets with `tsgo` against the built packages;
  run in CI as part of a new docs job. One-line inline fragments (an import line, a type name) may
  stay inline.
- Where available, Twoslash hovers (`@shikijs/vitepress-twoslash`) show real types in code blocks.
  This depends on Shiki compatibility found in the spike; it's optional.

### API reference generation

`site/scripts/gen-api.mjs` walks each package's `src/` (skipping `internal(s)`), reusing the same
export and JSDoc parsing rules as `scripts/verify-jsdoc.mjs` (shared by extracting a small module
in `scripts/` if that keeps one source of truth), and writes `site/api/<package>.md`. Output is
generated at build time and gitignored. The `@example` fences are already type-checked by
`verify-jsdoc`.

### Deployment

- New workflow `.github/workflows/docs.yml`, separate from `ci.yml`: on every PR, build packages →
  type-check snippets → build the site (no deploy), so a library change that breaks a snippet fails
  its PR. On push to `main`, also deploy to GitHub Pages (`actions/deploy-pages`), base path
  `/effect-rpc-experiment/`.
- Enabling Pages ("GitHub Actions" source) in the repo settings is a one-time manual step for the
  repo owner.

### Branch and delivery

`origin/main` holds only the initial commit; the library lives in open PR #1. The site goes on a new
branch `t3code/docs-site` stacked on `t3code/research-effect-rpc`, as its own PR based on PR #1's
branch. It can be previewed locally (`pnpm docs:dev`) and in the PR's build artifact; the first
Pages deploy happens once both PRs reach `main`. The PR is opened only when every section has
real content (no placeholder pages ship).

### Plan order (risk first)

1. Spike: VitePress under the workspace's Vite+ override. Fallbacks, in order: a scoped override so
   only the site gets plain `vite@5` (`"vitepress>vite"`), then VitePress 2 alpha. Record which
   worked; check Twoslash compatibility at the same time. If all three fail: stop and report to the
   user with the errors. Do not drop the workspace `vite` override, move the site out of the
   workspace, or switch tools without asking.
2. Theme (look) + navigation skeleton with placeholder pages.
3. API generator.
4. Content, section by section, with snippets type-checked as they are written.
5. CI workflow and Pages deploy.

## Calls I made (for the user to check)

- `site/` at the repo root as a private workspace package (rather than `docs/` or `packages/docs`).
- No Effect logo or copied components; own wordmark, look recreated with our own CSS.
- GitHub Pages as the host, deployed from a new workflow; the existing CI job is untouched.
- API pages generated, not hand-written; README stays the per-package overview.
- Snippets as type-checked files; Twoslash only if compatible.
- `docs:`-prefixed scripts and a separate `docs.yml`, so the existing pipeline is untouched but
  snippet breakage still fails PRs.
- A stacked PR on a new branch, opened once all sections have content.
- If the spike fails every fallback, stop and ask.

## Left to the builder

Exact Shiki themes, sidebar labels and ordering within a section, which snippets use `#region`,
how to split a long guide into sub-pages, home-page copy.
