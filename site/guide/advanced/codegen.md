# Schemas from handler types

Routers written with the `Procedure` builder can leave out `.output(...)` and `.error(...)`: the
handler types define the contract. [`@effect-trpc/codegen`](/api/codegen) turns those types into
schemas, so values cross the wire as real `Post` instances and typed errors stay typed.

## Install and run

```sh
pnpm add -D @effect-trpc/codegen   # needs typescript@7 (a peer dependency)

pnpm effect-trpc-codegen src/router.ts            # once
pnpm effect-trpc-codegen --watch src/router.ts    # next to the dev server
pnpm effect-trpc-codegen --check src/router.ts    # in CI: fails when the output is stale
```

`--project <tsconfig.json>` picks the TypeScript project (default `tsconfig.json`). In Vite-based
apps (Vite, Vitest, TanStack Start, electron-vite) the plugin replaces `--watch`:

```ts
// vite.config.ts
import { effectTrpcCodegen } from '@effect-trpc/codegen/vite';

export default { plugins: [effectTrpcCodegen({ routers: ['src/router.ts'] })] };
```

A build fails on generator errors; dev only warns, and regenerates on every change. Next.js
(Turbopack or webpack) has no plugin: run `effect-trpc-codegen --watch` next to `next dev`.

## What it writes

For `router.ts`, two modules next to it:

<<< @/snippets/concepts/router-service-inferred.ts#generated [router.gen.ts]

<<< @/snippets/concepts/router-service-inferred.ts#client [router.client.gen.ts]

- **`router.gen.ts` is for the server.** It wraps the router module with
  `Router.withSchemas`: the module is imported once, so state like a connection pool or an
  in-memory cache exists once. It is a plain router: serve it with
  `Handlers.fromProcedures(ServerRouter)` plus your middleware layers.
- **`router.client.gen.ts` is for clients.** Schema-only `query({...})` definitions with the same
  tags, middleware and schemas, and no handlers. It never imports the router module, so handler
  code and server-only imports (database clients, secrets) stay out of client bundles, with any
  bundler or none. A compile-time check in it fails with `router.client.gen.ts is out of date:
  run effect-trpc-codegen` when it no longer matches the server router.

Commit both (and run `--check` in CI), or ignore `*.gen.ts` and generate them before building.

## What maps to what

| Handler type                                  | Schema                                                               |
| --------------------------------------------- | -------------------------------------------------------------------- |
| `string`, `number`, `boolean`, `bigint`       | `Schema.String`, `Schema.Number`, `Schema.Boolean`, `Schema.BigInt`  |
| literals, `null`, `undefined`, unions         | `Schema.Literal`, `NullOr`, `UndefinedOr`, `Union`                   |
| `void`                                        | none (`Schema.Void`)                                                 |
| `Date`                                        | `Schema.Date`                                                        |
| `T[]`, `ReadonlyArray<T>`, tuples             | `Schema.mutable(Schema.Array(T))`, `Schema.Array(T)`, `Schema.Tuple` |
| `Map`, `Set`                                  | `Schema.ReadonlyMap`, `Schema.ReadonlySet`                           |
| `Record<string, T>`                           | `Schema.Record(Schema.String, T)`                                    |
| object types and interfaces                   | `Schema.Struct`                                                      |
| recursive named types                         | a `Schema.suspend` declaration                                       |
| `Schema.Class` / `Schema.TaggedError` classes | imported from their module                                           |

Failures that are Schema classes become the error schema. Anything else (a `Data.TaggedError`, a
raw `Error`) reaches the client as `RpcDefect`, and the generated client types leave it out.
Errors that a procedure's middleware declares are not repeated.

::: warning Gotchas

- Keep schemas, errors and middleware tags in a module the client can import, not in the router
  module: the client module would have to import the router module to reach them, and the
  generator stops with `move it to a module the client can import`.
- A plain class, a function, `any` or a type parameter has no schema. The generator reports the
  procedure's location: add `.output(schema)` there.
- The router is read statically: an exported router service class (`make: Effect.succeed({...})`)
  or `Router.make({...})` constant, with nested records, routers and router services. Records
  built with spreads or function calls are reported.
- Serving `router.ts` instead of `router.gen.ts` fails loudly: an inferred procedure that returns a
  value dies with a defect naming the fix.

:::
