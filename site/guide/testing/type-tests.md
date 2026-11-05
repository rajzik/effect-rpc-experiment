# Type tests

The error types are part of the API. A change to a schema or a middleware changes what clients must
handle. Type tests pin that down, so the change shows up in review instead of in production.

<<< @/snippets/testing/types.test-d.ts

Run them with `vitest --typecheck` (Vite+: `vp test` runs `*.test-d.ts` files as type tests). Each
`expectTypeOf(...).toEqualTypeOf<...>()` fails the build when the inferred type changes.

## What to pin

- The error union of each procedure clients branch on: `Client.Error<Def>`.
- Errors added by middleware (here `Unauthorized` from `Auth`).
- What components see: `inferProxyError` for TanStack Query.
- Outputs that must stay classes: `Client.Output<Def>` equal to the class, not a structural type.

::: tip
`// @ts-expect-error` is a type test too: for example, that a handler failing with an undeclared
error does not compile.
:::

See also: [type inference](../concepts/inference), [the error model](../concepts/errors).
