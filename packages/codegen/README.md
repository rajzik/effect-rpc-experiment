# @effect-trpc/codegen

Write routers without `.output(...)` / `.error(...)` and let the handler types define the
contract. The generator reads each handler's inferred `Effect<A, E>` / `Stream<A, E>` with the
TypeScript 7 checker and writes the schemas next to the router module:

| Module                 | Contents                                                                                                                                                                    | Import it from          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `router.gen.ts`        | `Router.withSchemas(AppRouter, { … })`: the router module itself (imported once, never copied) with the inferred schemas                                                    | the server              |
| `router.client.gen.ts` | the same contract as schema-only `query({...})` definitions: no handlers, no import of the router module, plus a compile-time check that it still matches the server router | clients (browser, apps) |

```ts
// router.ts: no `.output` / `.error`
export class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.succeed({
    byId: Procedure.input({ id: Schema.Finite }).query(
      Effect.fn(function* ({ id }) {
        const post = yield* findPost(id); // Effect<Post, PostNotFound | DbError>
        return post;
      }),
    ),
  }),
}) {}
```

```sh
effect-trpc-codegen src/router.ts            # once
effect-trpc-codegen --watch src/router.ts    # next to `next dev`, or any dev server
effect-trpc-codegen --check src/router.ts    # CI: exit 1 when a generated module is stale
```

```ts
// server.ts
import { AppRouter } from './router.gen.js';
const web = await toWebHandler(AppRouter, { handlers: Handlers.fromProcedures(AppRouter) });

// client.ts (browser bundle: no handler code, no server imports)
import { AppRouter } from './router.client.gen.js';
const client = createClient(AppRouter, { link: httpLink({ url: '/rpc' }) });
const post = await client.byId({ id: 1 }); // Post (a real instance); fails with PostNotFound
```

`DbError` (a `Data.TaggedError`, not a schema) is not part of the contract: it reaches the client
as `RpcDefect`, and the client types say so.

## Bundlers

The generator is also an [unplugin](https://unplugin.unjs.io), with one entry per bundler. It
generates when a build starts (and on every rebuild in watch mode), fails the build on generator
errors, and only warns in Vite dev, where every change regenerates:

| Bundler                                                    | Entry                                                                  |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| Vite (Vitest, TanStack Start, electron-vite, Astro, …)     | `@effect-trpc/codegen/vite`                                            |
| Rollup / Rolldown                                          | `@effect-trpc/codegen/rollup`, `/rolldown`                             |
| webpack (also Next.js with `--webpack`) / Rspack / Rsbuild | `@effect-trpc/codegen/webpack`, `/rspack`, `/rsbuild`                  |
| esbuild / Farm / Bun                                       | `@effect-trpc/codegen/esbuild`, `/farm`, `/bun`                        |
| Turbopack (Next.js default)                                | `@effect-trpc/codegen/loader` (a webpack loader)                       |
| any other unplugin target                                  | `@effect-trpc/codegen/unplugin` (`unplugin`, `codegenUnpluginFactory`) |

```ts
// vite.config.ts (every entry takes the same options)
import { effectTrpcCodegen } from '@effect-trpc/codegen/vite';

export default { plugins: [effectTrpcCodegen({ routers: ['src/router.ts'] })] };
```

Turbopack runs webpack loaders but not plugins: apply the loader to the router module.

```ts
// next.config.ts
const config: NextConfig = {
  turbopack: {
    rules: {
      '**/server/router.ts': {
        loaders: [
          { loader: '@effect-trpc/codegen/loader', options: { routers: ['src/server/router.ts'] } },
        ],
      },
    },
  },
};
```

The loader runs when the router module is compiled (the server imports `router.gen.ts`, which
imports it), so commit the generated modules or run `effect-trpc-codegen` once before the first
build.

## What maps to what

| Handler type                                  | Generated schema                                                      |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `string`, `number`, `boolean`, `bigint`       | `Schema.String`, `Schema.Number`, `Schema.Boolean`, `Schema.BigInt`   |
| literals, `null`, `undefined`, unions         | `Schema.Literal`, `NullOr`, `UndefinedOr`, `Union`                    |
| `void` (and `never`)                          | none (the default `Schema.Void`)                                      |
| `Date`                                        | `Schema.Date`                                                         |
| `T[]` / `ReadonlyArray<T>`, tuples            | `Schema.mutable(Schema.Array(T))` / `Schema.Array(T)`, `Schema.Tuple` |
| `Map<K, V>` / `Set<T>` (and readonly)         | `Schema.ReadonlyMap`, `Schema.ReadonlySet`                            |
| `Record<string, T>` (index signature)         | `Schema.Record(Schema.String, T)`                                     |
| plain object types, interfaces                | `Schema.Struct` (optional properties: `Schema.optional`)              |
| recursive named types (`interface Tree`)      | a hoisted `Schema.suspend` declaration                                |
| `Schema.Class` / `Schema.TaggedError` classes | imported from their module (`instanceof` works on the client)         |
| failure members that are Schema classes       | the error schema; other failures are defects                          |

A plain class, a function, `any` / `unknown` or an unresolved type parameter has no schema: the
generator reports it with its location and writes nothing for that module. Add `.output(schema)`
to that procedure.

## For AI agents

**Use this package when**

- a router is written with the `Procedure` builder **without** `.output(...)` / `.error(...)` and
  must be served or called (without the generated schemas a handler value dies with a defect
  naming the fix, and every failure is a defect);
- you want handler code and server-only imports out of client bundles: give clients
  `router.client.gen.ts`.

Do not use it for routers whose procedures all have `.output(...)` (nothing to infer), or for
`query({...})` / `Router.make` contracts implemented with `Handlers.make` (already schema-only).

**Entry points**

| Import path                 | Exports                                                                                                                                              | Source                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `@effect-trpc/codegen`      | `generate`, `createGenerator`, `runCommand`; types `GenerateOptions`, `GenerateResult`, `GeneratedFile`, `ProcedureReport`, `Generator`, `CommandIO` | `src/generate.ts`, `src/command.ts` |
| `@effect-trpc/codegen/vite` | `effectTrpcCodegen`; types `CodegenPlugin`, `CodegenPluginOptions`, `CodegenPluginContext`                                                           | `src/vite.ts`                       |
| bin `effect-trpc-codegen`   | `[--project tsconfig.json] [--watch \| --check] <router.ts>...`                                                                                      | `src/cli.ts`                        |

**Golden path**

1. Write the router (a router service class or a `Router.make` constant, exported) with
   `Procedure` chains and no `.output` / `.error`; keep schemas, errors and middleware tags in a
   separate module (e.g. `models.ts`).
2. `effect-trpc-codegen src/router.ts`, or the bundler plugin of your bundler
   (`@effect-trpc/codegen/<bundler>`; Turbopack: `@effect-trpc/codegen/loader`).
3. Server: `import { AppRouter } from './router.gen.js'`, serve with
   `Handlers.fromProcedures(AppRouter)` plus the middleware layers.
4. Clients: `import { AppRouter } from './router.client.gen.js'` for `createClient`,
   `createRpcContext`, framework adapters.
5. CI: `effect-trpc-codegen --check src/router.ts`.

**Invariants**

- Only chains without `.output(...)` / `.inferred(...)` are inferred; a user `.error(...)` is kept
  (and stays checked). Explicit chains and `query({...})` entries are copied to the client module
  as written.
- The server module imports the router module once (`Router.withSchemas`): no duplicated module
  state. It is a plain router: serve it with `Handlers.fromProcedures`, not `Handlers.fromService`.
- The client module imports only what its copied schema expressions reference (resolved through
  the router module's imports; top-level `const` schemas of the router module are copied).
- `__contract_<Router>` in the client module is a compile error (`router.client.gen.ts is out of
  date: run effect-trpc-codegen`) when the client contract no longer matches the server router.
- Errors declared by a procedure's middleware (or a nested router's `.middleware(...)`) are not
  repeated in the inferred error.
- Schema classes from other packages are imported by package name (the router's own import,
  else the checker's package path: workspace symlinks, `exports` subpaths, barrels, `paths`),
  never by a relative path into another package or `node_modules`.
- Output is deterministic: a second run with no source change reports every file unchanged.

**Common mistakes**

- Declaring a schema class or middleware tag **in the router module**: fine for the server, an
  error for the client module (`move it to a module the client can import`).
- Serving `router.ts` instead of `router.gen.ts`: inferred procedures have no output schema there.
- A recursive type that is not an exported interface / type alias: the hoisted declaration needs
  its name (`declare it as an exported interface or type`).
- Building router records dynamically (spreads, function calls): the generator reads the router
  statically and reports `cannot read this router entry statically`.
- A schema class its package does not export from any import path (an internal module of a
  dependency): reported as `is not exported by its package`; export it or import it in the router.
- Registering the unplugin with Turbopack: Turbopack ignores plugins; use the `/loader` in
  `turbopack.rules` instead.

**Verify**

```sh
pnpm exec vp -C packages/codegen test   # generator, CLI, plugin, runtime round trip, types
node scripts/verify-jsdoc.mjs codegen   # after `pnpm exec vp -C packages/codegen pack`
```

## Schemas from other packages

Schema classes can live in a workspace package or a published dependency, and the router does not
have to import them (a handler can return what a function from another package returns). The
generated modules import each class the way TypeScript's declaration emit would from the router
module:

- the router's own import of it, when there is one (copied as written);
- otherwise its package import path, as the checker resolves it: a pnpm / npm / yarn workspace
  symlink back to the package name, an `exports` subpath (`@acme/models/errors`), a barrel
  re-export, tsconfig `paths`, or a published package's `.d.ts`;
- otherwise (the same package) a relative import of the declaring module.

A class its package does not export from any import path is reported
(`… is not exported by its package`): export it, or import it in the router module.

## Limits

- Routers are read statically: an exported router service class whose `make` is
  `Effect.succeed({...})` / `Effect.sync(() => ({...}))`, or `Router.make({...})` (with
  `.middleware(...)`), with nested records, routers and router services.
- No code transform: the plugins only write the generated modules. The client stays
  handler-free because it imports the generated client module, which works with every bundler
  and without one.
- Requires TypeScript 7 (`typescript/unstable/sync`): a peer dependency.
