# @rpc-effect/core

tRPC-style routers and procedures for [Effect](https://effect.website) v4, compiled to a plain
[`effect/rpc`](https://effect.website) `RpcGroup`. This package holds the shared, transport-free
pieces of effect-trpc:

- **Procedure builders** — `query`, `mutation`, `subscription` — that describe a procedure with
  Effect Schemas (payload, success, error) and optional `RpcMiddleware`.
- **`Procedure`** — a tRPC-style builder (`Procedure.input(…).output(…).error(…).query(handler)`)
  whose procedures carry their schemas **and** their handler, with the handler's payload,
  return type, errors and requirements inferred.
- **`Router.make`** — nests procedures (and other routers) into a record; tags are the dot-joined
  paths (`"post.byId"`), with literal types computed at the type level.
- **Procedure metadata** — `.annotate(Key, value)` on a definition or a `Procedure` builder
  (tRPC's `meta`), read by middleware from `rpc.annotations`.
- **`HttpContext`** — read the HTTP request and set response headers and cookies from a handler or
  a middleware, without adding a requirement, so the same handlers run under every transport.
- **Router services** — write a router once as a plain Effect
  `Context.Service<Self>()(id, { make })` whose `make` returns the procedures; every API that takes
  a router takes the service class (`Router.from` normalises both).
- **The client error model** — `ClientError<E>` keeps your typed errors separate from
  infrastructure failures (`RpcDefect`, `RpcTransportError`, `RpcInterrupted`).
- **`Codecs`** — memoized JSON codecs for an rpc's payload, success, error and `Exit`, so
  `Schema.Class` and `Schema.TaggedError` instances survive any JSON boundary (SSR hydration,
  server actions, caches).

Servers, clients and the TanStack Query bridge live in `@rpc-effect/server`,
`@rpc-effect/client` and `@rpc-effect/tanstack-react-query`.

## For AI agents

**Use this package when**

- you define the API surface: procedures (`query`, `mutation`, `subscription`, or the
  `Procedure` builder when schemas and implementation live together) and a `Router` (or a router
  service: a `Context.Service` whose `make` returns the procedures) shared by server and client;
- a handler or middleware reads the HTTP request or sets a response header or cookie
  (`HttpContext`), or middleware needs per-procedure metadata (`.annotate`);
- you need the client error model (`ClientError<E>`, `causeToClientError`) or JSON codecs
  (`Codecs`) for a compiled rpc, without any transport.

Use a sibling instead to serve a router (`@rpc-effect/server`: `Handlers.make`, `toWebHandler`,
`createCaller`, `@rpc-effect/server/node`), to call one (`@rpc-effect/client`: `createClient`
with `httpLink`), for React Query (`@rpc-effect/tanstack-react-query`) or for test harnesses
(`@rpc-effect/test-utils`).

**Entry points**

| Import path        | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Source                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `@rpc-effect/core` | `query`, `mutation`, `subscription`, `isProcedureDef`, `ProcedureDef`, `PayloadInput`, `NormalizePayload`, `inferInput` / `inferOutput` / `inferError` / `inferKind`                                                                                                                                                                                                                                                                                     | `src/Procedure.ts`                       |
| `@rpc-effect/core` | `Procedure` (`input`, `output`, `error`, `inferred`, `middleware`, `annotate`, `query`, `mutation`, `subscription`, `hasHandler`; types `Procedure.HandlerContext`, `Procedure.HandlerRequirements`, `Procedure.Builder`, `Procedure.Infer`, `Procedure.InferredSuccess`), `ProcedureWithHandler`                                                                                                                                                        | `src/ProcedureBuilder.ts`                |
| `@rpc-effect/core` | `Router` (`make`, `merge`, `from`, `fromService`, `buildService`, `getByPath`, `getRpc`, `isPath`, `childPath`, `isRouter`, `isService`; types `Router.Input`, `Router.Of`, `Router.Shape`, `Router.ServiceShape`), `RouterService` (`RouterService.Any`, `RouterService.Pure`, `RouterService.MakeError`, `RouterService.MakeServices`, `RouterService.WithSchemas`), `ProcedureInfo`, `inferRouterInputs` / `inferRouterOutputs` / `inferRouterErrors` | `src/Router.ts`                          |
| `@rpc-effect/core` | `ProcedureKind` (annotation key + `"query" \| "mutation" \| "subscription"` type)                                                                                                                                                                                                                                                                                                                                                                        | `src/ProcedureKind.ts`                   |
| `@rpc-effect/core` | `HttpContext` (`request`, `setHeader`, `appendHeader`, `setCookie`)                                                                                                                                                                                                                                                                                                                                                                                      | `src/HttpContext.ts`                     |
| `@rpc-effect/core` | `ClientError`, `ClientInfrastructureError`, `RpcDefect`, `RpcTransportError`, `RpcInterrupted`, `causeToClientError`, `exitToClientError`, guards                                                                                                                                                                                                                                                                                                        | `src/ClientError.ts`                     |
| `@rpc-effect/core` | `Codecs` namespace (`payload`, `success`, `error`, `exit`, `encode*Sync` / `decode*Sync`)                                                                                                                                                                                                                                                                                                                                                                | `src/Codecs.ts` (barrel: `src/index.ts`) |

**Golden path** — define a router, implement `router.group` with plain `effect/rpc`, classify
failures (apps normally use `@rpc-effect/server` + `@rpc-effect/client` for the last two steps):

```ts
import { Effect, Exit, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';
import { causeToClientError, isClientInfrastructureError, query, Router } from '@rpc-effect/core';

// Domain data is a Schema.Class, typed errors are Schema.TaggedError classes.
class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.Number,
}) {}

// Nested record → tags are dot-joined paths ("post.byId").
export const appRouter = Router.make({
  post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
});
export type AppRouter = typeof appRouter; // what clients import

// router.group is a plain effect/rpc RpcGroup.
const HandlersLive = appRouter.group.toLayer({
  'post.byId': ({ id }) =>
    id === 1
      ? Effect.succeed(new Post({ id, title: 'Hello' }))
      : Effect.fail(new PostNotFound({ id })),
});

// Any failure collapses to ClientError<PostNotFound>.
const program = Effect.gen(function* () {
  const client = yield* RpcTest.makeClient(appRouter.group);
  const exit = yield* Effect.exit(client['post.byId']({ id: 7 }));
  if (Exit.isSuccess(exit)) return exit.value.title;
  const error = causeToClientError(exit.cause);
  return isClientInfrastructureError(error) ? error._tag : `not found: ${error.id}`;
});

console.log(await Effect.runPromise(program.pipe(Effect.scoped, Effect.provide(HandlersLive))));
// → "not found: 7"
```

**Invariants**

- Typed errors are `Schema.TaggedError` classes (discriminated by `_tag`); domain data is `Schema.Class`.
- `ClientError<E> = E | RpcDefect | RpcTransportError | RpcInterrupted`; infrastructure tags are `@rpc-effect/RpcDefect`, `@rpc-effect/RpcTransportError`, `@rpc-effect/RpcInterrupted`.
- A declared failure reaches the client as the same class instance; it is never wrapped in an infrastructure error.
- `causeToClientError` precedence: typed failure > defect (`RpcDefect`) > interruption (`RpcInterrupted`); `Fail(RpcClientError)` → `RpcTransportError`.
- Tags are the record paths joined by `"."`; keys are non-empty, contain no `"."` and are not `then`, `call` or `apply` (`Router.make` throws).
- `Router.merge(a, b)` requires disjoint top-level keys (throws `duplicate key`).
- Definitions and routers are frozen; `.middleware(M)` returns a new value; router-level middleware is added after a procedure's own middleware.
- `subscription` requires `success` (the element schema); it compiles to a stream rpc whose rpc-level error is `Schema.Never`.
- A `Procedure` builder procedure is a `ProcedureDef` with a `handler`: it compiles to the same rpc (tag, schemas, `ProcedureKind`) as the equivalent `query` / `mutation` / `subscription`, and `inferInput` / `inferOutput` / `inferError` are the same. Builder defaults match `query()`: `Schema.Void` / `Schema.Void` / `Schema.Never`.
- With `.output(...)`, a builder handler may fail only with the declared `error` plus the errors of middleware added **before** the terminal; its requirements are `Procedure.HandlerRequirements<typeof proc>` (as written, including middleware-provided services).
- `Router.withSchemas(source, schemas)` re-creates the named procedures with handlers with the given `{ output?, error? }` (the source is unchanged); unknown paths and schema-only definitions are compile errors and throw `no procedure "<path>"` / `"<path>" has no handler` if forced. Over a router it returns a router (serve with `Handlers.fromProcedures`). Over a router service (pure or effectful) it returns a router service with the **same key and `make`** (its value is the source's) whose router gets the schemas when it is built: nothing runs at the call, and a forced stale path throws when it is built (serve with `Handlers.fromService`; `Router.from(wrapped)` for a pure one).
- Without `.output(...)` a builder is in **inference mode**: `inferOutput` is the handler's success type (the success schema type is `Schema.declare<A>`, or `Schema.Void` for `void`), and the handler may fail with anything unless `.error(...)` was set. The runtime output schema stays `Schema.Void`: a handler value other than `undefined` dies with a defect naming the fix, until the schema generator writes `.inferred({ output, error })` into a generated copy of the router. `.inferred` sets the schemas, keeps the output checked and lets undeclared failures through (they reach the client as `RpcDefect`); it is what `Router.withSchemas` applies, not for hand-written code.
- `.middleware(M)` on a builder procedure and `router.middleware(M)` keep the handler (value and type); `query({...})` definitions have no `handler` key (`Procedure.hasHandler` is `false`).
- A router service's `make` is an `Effect` **value**. When it is `Effect<Record, never, never>` the service satisfies `RouterService.Pure` and every API takes the class. A `make` that reads services or may fail is only a `RouterService.Any`: it is a compile error at `Router.from`, `Router.fromService`, `Router.make` and every API taking `Router.Input` (`createClient`, `toWebHandler`, `serve`, `createCaller`, adapters, the test harness); those take the contract (a schema-only `Router.make` router, normally `router.client.gen.ts`) and the class is served with `Handlers.fromService` (`@rpc-effect/server`), which builds it with `Router.buildService`. Forcing the class, or a `make` that is asynchronous or fails, throws `Cannot build a router from the router service "<key>": make must be synchronous, read no services and not fail: give this API the contract (router.client.gen.ts) and serve the class with Handlers.fromService`, with the Effect failure as `cause`. Errors in the record itself (a stale `Router.withSchemas` path, an invalid key, a service that nests itself) throw their own message.
- `Router.fromService` is memoized per class: `make` runs once per process, and `Router.from`, `Router.fromService` and `Router.make({ x: Svc })` all return the same router for `Svc`.
- `Router.make` has two overloads: a service-free `Router.Shape` record returns `Router<Rec>` (unchanged, so generic code over `Rec extends Router.Shape` keeps compiling); a `Router.ServiceShape` record (router services at any depth) returns the router with the services resolved.
- `Router.make` resolves router-service entries (at any depth of plain records, and inside a service's own `make`) to routers: `router.record` and its type hold an ordinary nested router there. Records without services are stored as-is.
- Type helpers (`inferRouterInputs` / `Outputs` / `Errors`, `Router.Paths`, `Router.Rpcs`, `Router.Record`) accept a router, a router service class (`typeof AppRouter`) or a record; `Router.Of<X>` is the router type of either.
- Every compiled rpc carries the `ProcedureKind` annotation; rpcs not built by `Router.make` read as `"query"`.
- `.annotate(key, value)` (on `query` / `mutation` / `subscription` definitions, on the `Procedure` builder at any step and as `Procedure.annotate`) is tRPC's `meta`: it returns a new definition of the same type and the compiled rpc carries the value in `rpc.annotations`, read by middleware with `Context.get(rpc.annotations, Key)` (a `Context.Reference` key gives a default for procedures that do not set it). Annotating a key again replaces the value; `ProcedureKind` is applied last, so annotating that key does not change the kind. Annotations are runtime metadata of the server's rpc: they are not sent over the wire and the codegen client contract omits them. There is no router-level `.annotate`.
- `HttpContext.request` is `Option<HttpServerRequest>`: `Some` when the call arrived over HTTP (over WebSocket, the shared upgrade request), `None` under `createCaller`, `localLink`, Electron and the test harness. `setHeader` / `appendHeader` / `setCookie` are `Effect<void>` with no error and no requirement; a valid call is a no-op outside HTTP and over WebSocket, invalid input (CR/LF in a header, a bad cookie name) is a defect everywhere (`RpcDefect` on the client). The HTTP status cannot be set.
- With framed serialization (`ndjson`, the default) headers and cookies apply only if set before the first response chunk (the `Exit` of a query or mutation, the first element of a subscription); with `json` the whole response is collected first. Calls sent in one HTTP request (`httpBatchLink`) share one response.
- `Codecs.*` are memoized per rpc; `Codecs.success` of a subscription is the element codec; `*Sync` helpers throw `SchemaError` and do not support schemas with services.

**Common mistakes**

- Don't import Effect v3 packages (`@effect/rpc`, `@effect/platform`, `Context.Tag`) → use `effect/rpc`, `effect/http`, `Context.Service` from `effect@4`.
- Don't use dotted keys (`{ 'post.byId': … }`) → nest records (`{ post: { byId } }`); the tag is still `"post.byId"`.
- Don't `throw` / `Effect.die` for expected failures → declare a `Schema.TaggedError` in `error` and `Effect.fail` it; defects arrive as `RpcDefect`.
- Don't `JSON.stringify` / `JSON.parse` outputs, errors or exits across a boundary → use `Codecs.encode*Sync` / `decode*Sync` so `Schema.Class`, `Date` and tagged errors are restored.
- Don't match errors with `instanceof Error` or message strings → switch on `_tag` or use `isClientInfrastructureError`.
- Don't merge routers that share a top-level key → mount one under a prefix: `Router.make({ admin: adminRouter })`.
- Don't look up rpcs with an untyped string → `Router.getRpc(router, 'post.byId')` is typed (unknown tags are a type error, and throw at runtime).
- Don't expect `inferError` to include infrastructure errors → wrap it: `ClientError<inferError<typeof def>>`.
- Don't annotate builder handler parameters or return types → they are inferred from `input` / `output` / `error`; a mismatch is a compile error.
- Don't call `.error(...)` twice expecting a union → the last call wins; pass `Schema.Union([A, B])`.
- Don't add middleware after the terminal when the handler fails with the middleware's error → add `.middleware(M)` before `.query(...)`.
- Don't put secrets in builder handlers → handler code ships wherever the procedure is imported (browser bundles too); read services inside the handler.
- Don't pass a router service whose `make` reads services (`yield* AppConfig` in `make`) to `createClient`, `toWebHandler`, `Router.from` or any sync API → it is a compile error (a runtime error naming the fix if cast away); give them the contract (`router.client.gen.ts`) and serve the class with `Handlers.fromService`.
- Don't expect `Router.buildService` to memoize → every run runs `make` again, also for a class a sync API already built.
- Don't make `make` a function or asynchronous → `make: Effect.succeed({ ... })` or `Effect.gen`; the sync APIs run a pure `make` with `Effect.runSync`.
- Don't write `type AppRouter = typeof appRouter` for a router service → the class is the type: `inferRouterInputs<typeof AppRouter>`.
- Don't branch on "router or service" in your own adapter → call `Router.from(input)` once at the entry.
- Don't set headers or cookies per element of a subscription → each call registers a response hook that lives as long as the stream; set them once, before the first element (later ones are dropped with `ndjson`).
- Don't use `appendHeader('set-cookie', …)` → `setCookie`.
- Don't expect `HttpContext.request` to be `Some` under `createCaller` / `localLink` → handle `None`; it is `Some` only behind the HTTP adapters of `@rpc-effect/server`.
- Don't read `.annotate` values on the client or from a codegen client router → they are server-side metadata for middleware (`rpc.annotations`).

**Where to look**

| Behaviour                                                               | Test                                                       |
| ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| tags, nesting, key validation, merge, middleware order, `ProcedureKind` | `test/router.test.ts`                                      |
| `inferInput` / `inferOutput` / `inferError`, `Router.Rpcs` / `Paths`    | `test/inference.test-d.ts`                                 |
| `Procedure` builder: compiled rpc, defaults, handlers, middleware       | `test/procedureBuilder.test.ts`                            |
| builder handler typing, `HandlerRequirements`, parity with `query()`    | `test/procedureBuilder.test-d.ts`                          |
| router services: `fromService`, memoization, nesting, `make` errors     | `test/routerService.test.ts`                               |
| router-service inference, `Router.Of` / `Input`, `make` with services   | `test/routerService.test-d.ts`                             |
| `causeToClientError` mapping and precedence, guards                     | `test/client-error.test.ts`, `test/client-error.test-d.ts` |
| codec round-trips, memoization, middleware errors in `Codecs.error`     | `test/codecs.test.ts`, `test/codecs.test-d.ts`             |
| `.annotate`: compiled rpc, builder steps, `ProcedureKind` wins, types   | `test/annotate.test.ts`, `test/annotate.test-d.ts`         |
| `HttpContext`: no requirement, `None` outside HTTP, invalid input dies  | `test/httpContext.test.ts`, `test/httpContext.test-d.ts`   |
| end to end through `RpcTest.makeClient(router.group)`                   | `test/e2e.test.ts`                                         |
| this README's examples                                                  | `test/readme.test.ts`                                      |
| JSDoc conventions (every export has examples)                           | `docs/jsdoc-style.md`                                      |

**Verify**

```bash
pnpm exec vp -C packages/core test
pnpm exec vp -C packages/core pack
node scripts/verify-jsdoc.mjs core
```

## Install

```bash
pnpm add @rpc-effect/core effect
```

## Defining a router

```ts
import { Effect, Schema, Stream } from 'effect';
import { RpcMiddleware } from 'effect/rpc';
import { mutation, query, Router, subscription } from '@rpc-effect/core';
import type { inferError, inferInput, inferOutput } from '@rpc-effect/core';

// Output: a Schema.Class — clients receive real instances (methods, Date fields).
export class Post extends Schema.Class<Post>('Post')({
  id: Schema.Number,
  title: Schema.String,
  createdAt: Schema.Date,
}) {
  get slug() {
    return this.title.toLowerCase().replaceAll(' ', '-');
  }
}

// Errors: Schema.TaggedError classes, discriminated by `_tag`.
export class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.Number,
}) {}
export class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {
  reason: Schema.String,
}) {}
export class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}

// Any effect/rpc middleware can be attached to a procedure or a whole router.
export class Auth extends RpcMiddleware.Service<Auth>()('Auth', { error: Unauthorized }) {}

const byId = query({
  payload: { id: Schema.Number }, // struct fields or any schema
  success: Post,
  error: Schema.Union([PostNotFound, Forbidden]),
});

export const appRouter = Router.make({
  health: query({ success: Schema.Literal('ok') }), // no payload → input is `void`
  post: {
    byId,
    create: mutation({
      payload: { title: Schema.String },
      success: Post,
      error: Forbidden,
    }).middleware(Auth),
    onCreated: subscription({ success: Post }), // a stream of Post
  },
});

export type AppRouter = typeof appRouter;

type ByIdInput = inferInput<typeof byId>; // { readonly id: number }
type ByIdOutput = inferOutput<typeof byId>; // Post
type ByIdError = inferError<typeof byId>; // PostNotFound | Forbidden
```

`appRouter.group` is an ordinary `RpcGroup` with tags `"health"`, `"post.byId"`,
`"post.create"` and `"post.onCreated"`, so everything in `effect/rpc` works with it directly:

```ts
import { Layer } from 'effect';

const HandlersLive = appRouter.group.toLayer({
  health: () => Effect.succeed('ok' as const),
  'post.byId': ({ id }) =>
    id === 1
      ? Effect.succeed(new Post({ id, title: 'Hello', createdAt: new Date() }))
      : Effect.fail(new PostNotFound({ id })),
  'post.create': ({ title }) => Effect.succeed(new Post({ id: 2, title, createdAt: new Date() })),
  'post.onCreated': () => Stream.empty,
});

// Server side of the Auth middleware (a pass-through here).
const AuthLive = Layer.succeed(Auth)(Auth.of((effect) => effect));
```

(`@rpc-effect/server` adds nested handler records, HTTP/fetch adapters and an in-process caller.)

### Procedures with handlers (`Procedure`)

The `Procedure` builder declares a procedure's schemas and its implementation together. Each step
is optional and returns a new, frozen builder; the terminal (`query`, `mutation`,
`subscription`) takes the handler:

```ts
import { Context, Effect, Schema, Stream } from 'effect';
import { Procedure, Router } from '@rpc-effect/core';

class Database extends Context.Service<
  Database,
  { readonly findPost: (id: number) => Effect.Effect<Post, PostNotFound> }
>()('Database') {}

export const blogRouter = Router.make({
  post: {
    byId: Procedure.input({ id: Schema.Finite }) // struct fields or any schema
      .output(Post)
      .error(PostNotFound)
      .query(
        Effect.fn(function* ({ id }) {
          // id: number, inferred from .input
          const db = yield* Database; // services are read inside the handler
          return yield* db.findPost(id);
        }),
      ),
    create: Procedure.input({ title: Schema.String })
      .output(Post)
      .middleware(Auth) // before the terminal: the handler may fail with Unauthorized
      .mutation(({ title }) => Effect.succeed(new Post({ id: 2, title, createdAt: new Date() }))),
    onCreated: Procedure.output(Post).subscription(() => Stream.empty), // handlers return a Stream
  },
});

type Services = Procedure.HandlerRequirements<typeof blogRouter.record.post.byId>; // Database

// Each procedure keeps its implementation: `(payload, ctx) => Effect | Stream`.
const handler = blogRouter.record.post.byId.handler;
```

- The handler's payload is the decoded input; it must succeed with the decoded `output` and may
  fail only with `error` plus the errors of middleware added before the terminal (a mismatch is a
  compile error). Its second argument is the `effect/rpc` handler context
  (`Procedure.HandlerContext`: `headers`, `requestId`, `rpc`, `client`).
- A builder procedure is a regular `ProcedureDef`: it compiles to the same rpc as the equivalent
  `query({...})` and works with `Router.make`, `inferInput` & co. and every client. Defaults
  match `query()` (`Schema.Void` input and output, `Schema.Never` error).
- `.middleware(M)` on the finished procedure and `router.middleware(M)` keep the handler.
- In a router service, `make` must succeed with a record, not a router:
  `Effect.succeed(Router.make({...}).middleware(Auth))` is a compile error (and a
  `make must succeed with a record of procedures, not a router` error if forced). For a group,
  nest the router in the record: `admin: Router.make({...}).middleware(Auth)`.
- `Procedure.hasHandler(u)` tells builder procedures from `query({...})` definitions.

#### Inference mode (no `.output`)

Leave out `.output(...)` and the output type comes from the handler; without `.error(...)` the
handler may fail with anything:

```ts
const inferredRouter = Router.make({
  byId: Procedure.input({ id: Schema.Finite }).query(({ id }) =>
    id === 1
      ? Effect.succeed(new Post({ id, title: 'Hello', createdAt: new Date(0) }))
      : Effect.fail(new PostNotFound({ id })),
  ),
});

type ById = inferOutput<typeof inferredRouter.record.byId>; // Post
```

The types are only half of it: the schemas that send a `Post` (and decode `PostNotFound` on the
client) come from [`@rpc-effect/codegen`](../codegen/README.md), which reads the handler types
with the TypeScript 7 checker and writes `router.gen.ts` (`Router.withSchemas(router, { byId:
{ output: Post, error: PostNotFound } })`: serve it) and `router.client.gen.ts` (the schema-only
contract: give it to clients). Without them, a handler value other than `undefined` dies with a
defect that names the fix, and every failure arrives as `RpcDefect`.

`Router.withSchemas(source, schemas)` re-creates the named inferred procedures of a router (or
router service) with the given schemas, as `.inferred({ output, error })` would have: the router
module is evaluated once (no copy), nested routers keep their middleware, and a path that is not a
procedure with a handler is a compile error (and throws if forced). Over a router service it
returns a router service with the same key and `make` that runs nothing until it is built (the
schemas are set when its router is built): serve it with `Handlers.fromService`.

### Routers as services

A router can be written once as an ordinary Effect `Context.Service` whose `make` returns the
procedures. While `make` reads no services, the class is the router everywhere: pass it to any API
that takes a router, and use `typeof AppRouter` with the type helpers (a `make` that reads services
is served with `Handlers.fromService`; sync APIs take its contract, see below). No `as const` is needed.

```ts
import { Context, Effect, Schema } from 'effect';
import { Procedure, query, Router } from '@rpc-effect/core';
import type { inferRouterInputs } from '@rpc-effect/core';

export class AdminRouter extends Context.Service<AdminRouter>()('AdminRouter', {
  make: Effect.succeed({ count: Procedure.output(Schema.Finite).query(() => Effect.succeed(1)) }),
}) {}

export class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.succeed({
    health: query({ success: Schema.Literal('ok') }), // plain definitions mix in
    post: {
      byId: Procedure.input({ id: Schema.Finite })
        .output(Post)
        .error(PostNotFound)
        .query(
          Effect.fn(function* ({ id }) {
            const db = yield* Database; // services are read inside handlers (or in make: see below)
            return yield* db.findPost(id);
          }),
        ),
    },
    admin: AdminRouter, // services nest like routers
  }),
}) {}

type ByIdInput = inferRouterInputs<typeof AppRouter>['post']['byId']; // { readonly id: number }
type Paths = Router.Paths<typeof AppRouter>; // "health" | "post.byId" | "admin.count"

const router = Router.from(AppRouter); // Router.Of<typeof AppRouter>, memoized per class
const mixed = Router.make({ app: AppRouter }); // mixed.record.app is that same router
```

- `make` is an `Effect` value. With no requirements and no failure (`Effect<Record, never, never>`)
  the class works with every API. A `make` that reads services is allowed too (an effectful router
  service) but only `Handlers.fromService` takes the class; everything else takes the contract (see
  `Router.buildService`). One that is asynchronous throws a clear error naming the service when the
  router is built synchronously.
- `Router.fromService(Svc)` runs `make` with `Effect.runSync` once per class and compiles the
  record with `Router.make`; `Router.from(x)` accepts a router or a service (`Router.Input`) and
  returns the router. `Router.isService(u)` is the guard.

### Router API

| API                                                                | Description                                                                                                                                                             |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Router.make(record)`                                              | Compile a nested record of procedures / routers / router services / records. Throws on keys containing `"."`, empty keys and the reserved keys `then`, `call`, `apply`. |
| `router.group`                                                     | `RpcGroup<Router.Rpcs<typeof record>>` — tags are dot-joined paths.                                                                                                     |
| `router.procedures`                                                | `ReadonlyMap<tag, { path, tag, kind, rpc }>` in definition order.                                                                                                       |
| `router.record`                                                    | The original record (nested routers kept as-is; router services replaced by their routers).                                                                             |
| `router.middleware(M)`                                             | New router with `M` applied to every procedure (after per-procedure middleware).                                                                                        |
| `Router.merge(a, b)`                                               | Merge two routers; overlapping top-level keys throw.                                                                                                                    |
| `Router.from(input)`                                               | A router for a `Router.Input` (router or router service class).                                                                                                         |
| `Router.fromService(Svc)`                                          | The router of a router service; runs `make` once per class.                                                                                                             |
| `Router.buildService(Svc)`                                         | An `Effect` that runs `make` (and nested makes) in the current context: `{ router, value }`. For a `make` that reads services; not memoized.                            |
| `Router.getByPath(router, ['post','byId'])`                        | `Option<ProcedureInfo>`.                                                                                                                                                |
| `Router.getRpc(router, 'post.byId')`                               | The compiled rpc, precisely typed (`Rpc<"post.byId", …>`).                                                                                                              |
| `Router.isPath(router, ['post'])`                                  | `true` for a declared namespace or procedure.                                                                                                                           |
| `Router.childPath(router, path, key)`                              | Key policy shared by router proxies: introspection keys (`then`, `toJSON`, ...) resolve only when declared.                                                             |
| `Router.isRouter(u)` / `Router.isService(u)` / `isProcedureDef(u)` | Guards.                                                                                                                                                                 |

Type helpers: `Router.Rpcs<R>`, `Router.Paths<R>` (`"health" | "post.byId" | …`),
`Router.Record<R>`, `Router.Of<X>` / `Router.Input`, `RouterService.Any` / `RouterService.Pure` / `RouterService.MakeError<S>` / `RouterService.MakeServices<S>`, `inferInput` / `inferOutput` / `inferError` / `inferKind` for a procedure
(subscription output is the element type; middleware errors are included in `inferError`), and
`inferRouterInputs` / `inferRouterOutputs` / `inferRouterErrors` for nested maps of a whole router
(each router helper also accepts a router service class).

Every compiled rpc carries a `ProcedureKind` annotation:
`Context.get(rpc.annotations, ProcedureKind) // "query" | "mutation" | "subscription"`.
Subscriptions compile to `Rpc.make(tag, { stream: true, … })`.

### Metadata (`.annotate`)

`.annotate(Key, value)` is tRPC's `meta`. It stores a value on the procedure, and a middleware reads
it from the compiled rpc:

```ts
import { Context, Effect, Layer, Schema } from 'effect';
import { RpcMiddleware } from 'effect/rpc';
import { Procedure, query, Router } from '@rpc-effect/core';

class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {}) {}
class CurrentUser extends Context.Service<CurrentUser, { readonly roles: ReadonlyArray<string> }>()(
  'CurrentUser',
) {}
class RequireRoles extends RpcMiddleware.Service<RequireRoles, { requires: CurrentUser }>()(
  'RequireRoles',
  { error: Forbidden },
) {}
// A `Context.Reference` gives the default for procedures that do not set it.
const Roles = Context.Reference<ReadonlyArray<string>>('Roles', { defaultValue: () => [] });

export const appRouter = Router.make({
  health: query({ success: Schema.Literal('ok') }),
  stats: query({ success: Schema.Number }).annotate(Roles, ['admin']),
  purge: Procedure.annotate(Roles, ['admin']) // the builder takes it at any step
    .output(Schema.Void)
    .mutation(() => Effect.void),
}).middleware(RequireRoles);

// `CurrentUser` comes from a trusted source: an auth middleware added after this one (it runs
// first) or `Handlers.withContext`. Never take roles from a client-sent header.
export const RequireRolesLive = Layer.succeed(RequireRoles)(
  RequireRoles.of((effect, { rpc }) =>
    Effect.flatMap(CurrentUser, (user) =>
      Context.get(rpc.annotations, Roles).every((role) => user.roles.includes(role))
        ? effect
        : Effect.fail(new Forbidden()),
    ),
  ),
);
```

`.annotate` returns a new definition of the same type; annotating a key again replaces its value;
`ProcedureKind` always wins over an annotation of that key. Annotations stay on the server's rpc
(they are not sent over the wire).

## Request and response (`HttpContext`)

`HttpContext` reads the HTTP request and sets response headers and cookies from a handler or a
middleware. None of its members adds a requirement or an error, so the same handlers still run
under `createCaller`, `localLink`, Electron and tests, where `request` is `None` and valid setter
calls do nothing:

```ts
import { Effect, Option, Schema } from 'effect';
import { HttpContext, Procedure, Router } from '@rpc-effect/core';

export const appRouter = Router.make({
  login: Procedure.input({ token: Schema.String }).mutation(({ token }) =>
    Effect.gen(function* () {
      const request = yield* HttpContext.request; // Option<HttpServerRequest>
      const agent = Option.match(request, {
        onNone: () => 'local',
        onSome: (req) => req.headers['user-agent'] ?? 'unknown',
      });
      yield* HttpContext.setHeader('x-login-agent', agent);
      yield* HttpContext.setCookie('session', token, { httpOnly: true, path: '/' });
    }),
  ),
});
```

| API                                       | Description                                          |
| ----------------------------------------- | ---------------------------------------------------- |
| `HttpContext.request`                     | `Option<HttpServerRequest>` of the current call.     |
| `HttpContext.setHeader(name, value)`      | Sets a response header (replaces earlier values).    |
| `HttpContext.appendHeader(name, value)`   | Appends to a response header (`a, b`).               |
| `HttpContext.setCookie(name, value, opt)` | Sets a cookie; `opt` is `Cookies.Cookie['options']`. |

Gotchas: with `ndjson` (the default) headers and cookies apply only if set before the first response
chunk (the `Exit` of a query or mutation, the first element of a subscription), so set them once and
up front, not per stream element; calls batched into one HTTP request share one response; over
WebSocket the setters do nothing; an invalid header or cookie is a defect everywhere. In
`@rpc-effect/server`, `Handlers.withContext` adds services computed per call and the HTTP adapters
take an `onError` option.

## The ClientError model

A client call for a procedure with error type `E` can fail with exactly:

```ts
type ClientError<E> = E | RpcDefect | RpcTransportError | RpcInterrupted;
```

| Error               | `_tag`                          | When                                                                             |
| ------------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| `E`                 | your tags                       | the handler failed with a declared error — the **same instance** (decoded class) |
| `RpcDefect`         | `@rpc-effect/RpcDefect`         | the handler died / threw, or a response could not be decoded (`cause` = defect)  |
| `RpcTransportError` | `@rpc-effect/RpcTransportError` | network / HTTP / protocol failure (`cause` = the `effect/rpc` `RpcClientError`)  |
| `RpcInterrupted`    | `@rpc-effect/RpcInterrupted`    | the call was aborted or interrupted                                              |

Domain errors are never disguised as infrastructure errors and vice versa. All three
infrastructure errors are `Schema.TaggedError`s (their `cause` uses `Schema.Defect`), so they can
be serialized too.

```ts
import { Exit } from 'effect';
import { RpcTest } from 'effect/rpc';
import { causeToClientError, isClientInfrastructureError } from '@rpc-effect/core';

const program = Effect.gen(function* () {
  const client = yield* RpcTest.makeClient(appRouter.group); // in-memory client
  const exit = yield* Effect.exit(client['post.byId']({ id: 7 }));
  if (Exit.isSuccess(exit)) return exit.value.slug;

  const error = causeToClientError(exit.cause); // ClientError<PostNotFound | Forbidden>
  if (isClientInfrastructureError(error)) return `infrastructure: ${error._tag}`;
  return error._tag === 'PostNotFound'
    ? `not found: ${error.id}` // error: PostNotFound
    : `forbidden: ${error.reason}`; // error: Forbidden
});

await Effect.runPromise(
  program.pipe(Effect.scoped, Effect.provide(Layer.merge(HandlersLive, AuthLive))),
);
// → "not found: 7"
```

`causeToClientError` maps `Fail(e)` → `e` (or `RpcTransportError` if `e` is an `RpcClientError`),
`Die` → `RpcDefect` (message from `defect.message` or `String(defect)`), interruption-only →
`RpcInterrupted`; typed failures win over defects, defects over interruption.
`exitToClientError(exit)` returns `Option<ClientError<E>>`.

## Codecs

`Codecs` derives `Schema.toCodecJson` codecs from a compiled rpc (memoized per rpc):

```ts
import { Codecs, Router } from '@rpc-effect/core';

const rpc = Router.getRpc(appRouter, 'post.byId'); // Rpc<"post.byId", ...>

const encodedExit = JSON.stringify(
  Codecs.encodeExitSync(rpc, Exit.fail(new PostNotFound({ id: 7 }))),
);
// {"_tag":"Failure","cause":[{"_tag":"Fail","error":{"_tag":"PostNotFound","id":7}}]}
const exit = Codecs.decodeExitSync(rpc, JSON.parse(encodedExit));
// Exit<Post, PostNotFound | Forbidden> — the failure is a real PostNotFound instance again

const post = new Post({ id: 1, title: 'Hello World', createdAt: new Date(0) });
const encodedPost = JSON.stringify(Codecs.encodeSuccessSync(rpc, post));
// {"id":1,"title":"Hello World","createdAt":"1970-01-01T00:00:00.000Z"}
const decoded = Codecs.decodeSuccessSync(rpc, JSON.parse(encodedPost));
decoded instanceof Post; // true; decoded.slug === "hello-world"; decoded.createdAt is a Date
```

The example above is kept honest by `test/readme.test.ts`.

| Codec                 | Schema                                                                      |
| --------------------- | --------------------------------------------------------------------------- |
| `Codecs.payload(rpc)` | the payload schema                                                          |
| `Codecs.success(rpc)` | the success schema — for subscriptions, the **element** schema              |
| `Codecs.error(rpc)`   | union of the error schema, stream error schema and middleware error schemas |
| `Codecs.exit(rpc)`    | `Rpc.exitSchema(rpc)` — `Exit<Success, Error>` (`void` success for streams) |

Each has `encode*Sync` / `decode*Sync` helpers (they throw `SchemaError` on invalid input and do
not support schemas that need encoding/decoding services — use the codec with
`Schema.encodeEffect` / `Schema.decodeUnknownEffect` for those).
