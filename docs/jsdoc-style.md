# JSDoc style (Effect-style, written for AI agents)

effect-trpc documents its public API the way `effect` does (see
`node_modules/effect/src/Equivalence.ts` or `src/rpc/RpcClient.ts` for reference). The JSDoc is
the primary documentation an agent sees on hover, in `.d.mts` files and in `node_modules/**/src`,
so it must answer: _what is this, when do I reach for it, what will surprise me, and what does
correct code look like?_

`node scripts/verify-jsdoc.mjs` enforces the structure and type-checks every example
(`pnpm docs:check`; run `vp run -r build` first, examples resolve through `dist/*.d.mts`).

## Module header

Every file in `src/` (barrels included, `internal/` and `internals/` excluded) opens with a JSDoc
block, before imports and before any `'use client'` directive:

```ts
/**
 * Builds tRPC-style procedure definitions (`query`, `mutation`, `subscription`) from Effect
 * Schemas.
 *
 * A procedure definition is a plain description: payload/success/error schemas, a kind and
 * optional `RpcMiddleware`. `Router.make` compiles definitions into `effect/rpc` rpcs whose tags
 * are the dot-joined router paths.
 *
 * @since 0.1.0
 */
```

The first paragraph is one sentence that says what the module is for. The second explains how it
fits with the rest of effect-trpc (which package consumes its output, which `effect/rpc` concept
it wraps).

## Exports

Every `export` (const, function, class, interface, type, namespace, enum) gets a block. Order of
sections, all optional except the summary and the tags:

````ts
/**
 * <One-sentence summary in the present tense: "Creates…", "Returns…", "A…".>
 *
 * **When to use**
 *
 * Use when <the situation>. Prefer `<other API>` when <the other situation>.
 *
 * **Details**
 *
 * - <behaviour an agent cannot guess from the signature: defaults, encoding, lifecycle,
 *   which errors land in the typed channel vs `RpcDefect` / `RpcTransportError`>
 *
 * **Gotchas**
 *
 * - <the mistake an agent is likely to make, and what to do instead>
 *
 * **Example** (<Short title of the scenario>)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 *
 * // Comments explain *why*, not what.
 * const router = Router.make({ ping: query({ success: Schema.String }) });
 * ```
 *
 * @see {@link otherExport}
 * @category constructors
 * @since 0.1.0
 */
````

Rules:

- **Tags.** `@since 0.1.0` on everything public (bump when a later release adds a symbol).
  `@category` on every top-level export. Namespace members need a description and `@since`.
  Interface/object properties get a one-line `/** … */` when the meaning is not obvious from the
  name.
- **Examples.** Every top-level _value_ export (const, function, class) has at least one
  `**Example** (Title)` followed by a ` ```ts ` (or ` ```tsx `) fence. Examples are compiled with
  the repo's strict `tsconfig.base.json` (`exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`), so they must be complete programs: real imports from the package's
  public entry (`@effect-trpc/<name>` or its subpaths, never `../src`), every identifier declared.
  Use `declare const x: T` for values the example takes as given. Only import packages listed in
  that package's `dependencies`, `devDependencies` or `peerDependencies`. Mark a fence
  ` ```ts nocheck ` only when it cannot compile in isolation (e.g. a file split across processes),
  and say why in the prose.
- **Realistic code.** Show the way the API is meant to be used in an app (router module, server
  entry, React component), not toy one-liners. Base examples on the package's tests and README.
  Typed errors are `Schema.TaggedError` classes, domain data is `Schema.Class`.
- **Effect v4 only.** `Context.Service`, `yield* Service`, `Schema.TaggedError<Self>()(tag, …)`,
  `effect/rpc`, `effect/http`. Grep `node_modules/effect/dist/**/*.d.ts` when unsure.
- **Categories.** Reuse these names: `constructors`, `models`, `guards`, `errors`, `codecs`,
  `combinators`, `getters`, `type-level`, `layers`, `links`, `handlers`, `adapters`, `hooks`,
  `components`, `options`, `hydration`, `testing`, `utils`.
- **Internal exports.** An export that is public only for other effect-trpc packages gets
  `@internal` plus a one-line description. It is exempt from the other rules.
- **No drift.** Never describe behaviour the code does not have. If you find a mismatch, fix the
  doc and mention it in your report; do not change runtime behaviour while documenting.
