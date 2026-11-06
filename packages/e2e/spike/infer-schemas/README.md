# Spike: infer `.output` / `.error` at build time

Question: can a build step read each handler's inferred `Effect<A, E>` / `Stream<A, E>` and inject
the matching schemas, so a router needs no `.output(...)` / `.error(...)` and the runtime still
encodes class instances, Dates and typed errors?

**Answer: yes for the runtime.** TypeScript 7's checker API (`typescript/unstable/sync`, already a
dependency via `typescript@7.0.2`) gives every handler's `A` and `E`, including `Effect.fn`
generators, and the generator traces them back to schema declarations. The builder side is
built in `@effect-trpc/core`: inference mode (no `.output`) and the `.inferred({ output, error })`
step the generator writes (see `Procedure` in `packages/core/src/ProcedureBuilder.ts`).

```sh
node packages/e2e/spike/infer-schemas/generate.mjs packages/e2e/spike/infer-schemas/tsconfig.json \
  packages/e2e/spike/infer-schemas/router.ts      # writes router.gen.ts (~65-130 ms incl. startup)
pnpm exec vp test --root packages/e2e/spike/infer-schemas   # 9 tests against router.gen.ts
```

| File              | Role                                                                           |
| ----------------- | ------------------------------------------------------------------------------ |
| `models.ts`       | ordinary schemas (`Schema.Class`, `Schema.TaggedError`) + a `Data.TaggedError` |
| `router.ts`       | router service with **no** `.output` / `.error`                                |
| `generate.mjs`    | the generator (checker API → schema expressions → injected source)             |
| `router.gen.ts`   | generated output: the same router with `.inferred({ output, error })`          |
| `runtime.test.ts` | served over HTTP, called with `createClient`                                   |

## What was proven

- Schema classes are **imported, not re-synthesised** (`Post` → `__m0.Post`), so transformations,
  brands, getters and `instanceof` survive. A class is a schema when its constructor has a static
  `ast`.
- Anonymous shapes map structurally: `{ items: Post[]; nextCursor: number | null }` →
  `Schema.Struct({ items: Schema.Array(Post), nextCursor: Schema.NullOr(Schema.Number) })`; also
  literals, `Date`, `T | undefined`, tuples, optional properties, `boolean`. TS `number` maps to
  `Schema.Number`, which round-trips `NaN` / `Infinity` through JSON.
- Handlers returning a union of effects (`cond ? Effect.fail(a) : Effect.succeed(b)`) are read
  member by member.
- Errors: Schema-class members of `E` become `error` (`DbError | Forbidden` → `Forbidden`); the
  rest (`DbError`, a `Data.TaggedError`) is not declared and arrives as `RpcDefect`. Errors the
  chain's middleware declares are not repeated. A user `.error(...)` is kept and stays checked.
- Explicit chains (`.output(...)`) are left alone. Unmappable outputs fail with the location: a
  plain class ("instances would arrive as plain objects") or a function.
- Types: `router.ts` and `router.gen.ts` both type-check; the client types of the generated
  router are exact (`create` fails with `ClientError<Forbidden>`, not `DbError`), asserted in
  `runtime.test.ts` and checked by `pnpm check`.
- Control: the same runtime test against the source `router.ts` fails.

## Not done yet

1. A published CLI (`effect-trpc generate`) and a bundler plugin (watch mode, stripping
   handlers from client bundles). Turbopack does not run unplugin plugins.
2. Recursive types, generics, `Record<string, T>`, `Map` / `Set`, `bigint` are not mapped.
3. The generated file is a full copy of the router module: import only the generated one, or
   module state (like `posts` here) exists twice.
