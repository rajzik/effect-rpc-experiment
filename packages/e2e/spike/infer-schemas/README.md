# Spike: infer `.output` / `.error` at build time

Question: can a build step read each handler's inferred `Effect<A, E>` / `Stream<A, E>` and inject
the matching schemas, so a router needs no `.output(...)` / `.error(...)` and the runtime still
encodes class instances, Dates and typed errors?

**Answer: yes for the runtime.** TypeScript 7's checker API (`typescript/unstable/sync`, already a
dependency via `typescript@7.0.2`) gives every handler's `A` and `E`, including `Effect.fn`
generators, and the generator traces them back to schema declarations.

```sh
node packages/e2e/spike/infer-schemas/generate.mjs packages/e2e/spike/infer-schemas/tsconfig.json \
  packages/e2e/spike/infer-schemas/router.ts      # writes router.gen.ts (~65-130 ms incl. startup)
pnpm exec vp test --root packages/e2e/spike/infer-schemas   # 6 tests against router.gen.ts
```

| File              | Role                                                                           |
| ----------------- | ------------------------------------------------------------------------------ |
| `models.ts`       | ordinary schemas (`Schema.Class`, `Schema.TaggedError`) + a `Data.TaggedError` |
| `router.ts`       | router service with **no** `.output` / `.error`                                |
| `generate.mjs`    | the generator (checker API → schema expressions → injected source)             |
| `router.gen.ts`   | generated output: the same router with `.output(...)` / `.error(...)`          |
| `runtime.test.ts` | served over HTTP, called with `createClient`                                   |

## What was proven

- Schema classes are **imported, not re-synthesised** (`Post` → `__m0.Post`), so transformations,
  brands, getters and `instanceof` survive. A class is a schema when its constructor has a static
  `ast`.
- Anonymous shapes map structurally: `{ items: Post[]; nextCursor: number | null }` →
  `Schema.Struct({ items: Schema.Array(Post), nextCursor: Schema.NullOr(Schema.Number) })`; also
  literals, `Date`, `T | undefined`, tuples, optional properties, `boolean`.
- Errors: Schema-class members of `E` become `.error(...)` (`DbError | Forbidden` → `Forbidden`);
  the rest (`DbError`, a `Data.TaggedError`) is not declared and arrives as `RpcDefect`.
- Unmappable outputs fail with the location: a plain class ("instances would arrive as plain
  objects") or a function. An explicit `.output(...)` / `.error(...)` is never touched.
- Control: the same test against the source `router.ts` fails 6/6.

## What is not solved yet

1. **Types without `.output`.** The builder today requires the handler to return
   `Success['Type']` (default `void`), so `router.ts` does not type-check (it is lint-ignored).
   The builder needs an inference mode: no `.output` → accept any `Effect<A, E, R>`.
2. **Client types must match the runtime.** Instance types of `Schema.TaggedError` and
   `Data.TaggedError` are indistinguishable at the type level, so inferring the client error type
   from `E` would type `DbError` as a typed error while it arrives as a defect. Fix: the client
   takes its types from the **generated** module (explicit schemas), so they are exact.
3. **Undeclared failures in the generated file.** `router.gen.ts` declares `.error(Forbidden)`
   while the handler may fail with `DbError`; this runs (defect) but does not type-check, so the
   gen file is lint-ignored. The inference-mode builder must allow undeclared failures.
4. Middleware errors are re-declared if the handler propagates them (harmless duplicates in the
   union); not filtered yet.
5. Recursive types, generics, `Record<string, T>`, `Map`/`Set`, `bigint` JSON are not mapped.
6. Plugin / watch mode, handler stripping for client bundles and Turbopack: not attempted.
