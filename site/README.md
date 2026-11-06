# effect-trpc documentation site

The [VitePress](https://vitepress.dev) site published at
<https://rajzik.github.io/effect-rpc-experiment/>. Guides are hand-written Markdown, every code
sample is a type-checked file, and the API reference is generated from the packages' JSDoc.

## Run it

```sh
pnpm exec vp run -r build   # samples and the API generator read the built packages
pnpm docs:dev               # http://localhost:5173/effect-rpc-experiment/
pnpm docs:build             # → site/.vitepress/dist; fails on dead links
```

From `site/`: `pnpm docs:snippets` type-checks the samples, `pnpm docs:test` runs the site tests,
`pnpm docs:api` regenerates `api/`.

## Deploy

The site is deployed on Vercel (project `effect-trpc-docs`, <https://effect-trpc-docs.vercel.app>)
through its GitHub integration, configured by `vercel.json` at the repo root (Root Directory left
empty; the root `pnpm install`, then the packages are built first, as CI does):

- **Production**: every push to `main`.
- **Previews**: every push to a pull request gets its own deployment. Vercel posts the URL as a
  `Vercel` check and a comment on the PR, and keeps it updated on new pushes.

`.github/workflows/docs.yml` only builds and tests the site (dead links, API coverage, samples);
it does not deploy. The site is served at `/`; `DOCS_BASE` sets another base path for a host that
needs one (`DOCS_BASE=/docs/ pnpm docs:build`). It must start and end with `/`.

## Layout

```
.vitepress/config.ts      site config (base path, nav, search, edit links)
.vitepress/sidebar.ts     the sidebar: every page must be listed here
.vitepress/theme/         effect.website-style tokens and overrides (our own CSS)
guide/                    hand-written pages
snippets/                 every sample shown on a page, type-checked with tsgo
snippets/shared/          the demo router (`@/router`) and its server (`@/server`)
snippets/testing/         samples that also run as Vitest tests
scripts/gen-api.mjs       JSDoc → api/*.md (generated, gitignored)
test/                     oracles: build output, theme, generator coverage, snippet usage
```

## Add a page

1. Write `guide/<section>/<page>.md`.
2. Add it to `.vitepress/sidebar.ts`.
3. Put each non-trivial sample in `snippets/<section>/<name>.ts(x)` and import it with
   `<<< @/snippets/<section>/<name>.ts` (or `#region` for part of a file).
4. `pnpm docs:snippets && pnpm docs:build && pnpm docs:test`.

Rules the tests enforce: every snippet is used by a page, every referenced snippet exists, every
sidebar link has a page, no page ships placeholder text, every export of every package entry has an
anchor in the API reference.

## Notes

- VitePress 1.x needs Vite 5 with esbuild. The workspace overrides `vite` to the Vite+ core, so
  `pnpm-workspace.yaml` scopes `vitepress>vite` to Vite 5, and the site pins its own `vite` to the
  Vite+ core so Vitest keeps resolving to it.
- No Twoslash hovers: the repo's TypeScript is 7 (native), which has no JS compiler API.
- Facts on the site come from the code, its JSDoc and the package READMEs. When they disagree, the
  code wins: fix the README too.
