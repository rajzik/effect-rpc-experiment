# @effect-trpc/server

Serve an [`@effect-trpc/core`](../core) router with [Effect](https://effect.website) v4. Built
directly on `effect/rpc` (`RpcServer`, `RpcGroup.toLayer`, `RpcTest`), it adds the tRPC-shaped
pieces:

- **`Handlers.make(router, nested)`** — implement procedures with a record that mirrors the router
  (`{ post: { byId: ({ id }, ctx) => Effect } }`). Missing handlers and wrong payload / success /
  error types are compile errors.
- **`Handlers.fromService(AppRouter)` / `Handlers.fromProcedures(router)`** — for a router written
  once with `Procedure` (schemas + handler), as an Effect service or a plain router: the layer is
  built from the procedures' own handlers, with every requirement inferred.
- **`toWebHandler(router, { handlers })`** — a fetch handler (`Request → Response`) for Next.js,
  TanStack Start, Bun, Deno, Cloudflare, Hono, ...
- **`layerHttp(router, { handlers })`** — the same endpoint as an Effect `HttpRouter` layer, to
  compose into an existing Effect HTTP app.
- **`createCaller(router, { handlers })`** — an in-process typed caller (tRPC's `createCaller`):
  Effect and Promise APIs, middleware included, no serialization.
- **`Middleware`** — `effect/rpc`'s `RpcMiddleware` plus `Middleware.make` for auth/context.
- **`@effect-trpc/server/node`** — `serve` (a Layer) and `runServer` (a Promise) on Node's `http`.

Every function that takes a `router` also takes a router service class (`toWebHandler(AppRouter,
...)`); it is normalised with `Router.from` once at the call.

Every HTTP endpoint uses `protocol: "http"` and `disableFatalDefects: true`: typed failures and
defects are encoded into that call's `Exit` and later calls keep working. `Schema.Class` results
and `Schema.TaggedError` failures are encoded with their schemas, so clients receive real
instances (methods, `Date` fields, `instanceof`).

## For AI agents

**Use this package when**

- you implement an `@effect-trpc/core` router (`Handlers.make`, or `Handlers.fromService` /
  `Handlers.fromProcedures` for `Procedure` routers) and serve it over HTTP
  (`toWebHandler`, `layerHttp`, `@effect-trpc/server/node`);
- you call a router in-process from tests, scripts or SSR (`createCaller`);
- you add auth / request context with `Middleware`.

Use a sibling instead to define procedures and routers (`@effect-trpc/core`), to call a server
from another process or the browser (`@effect-trpc/client`), or for React Query hooks
(`@effect-trpc/tanstack-react-query`).

**Entry points**

| import path                | exports                                                                                                                                                                                                                                                                                        | source                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `@effect-trpc/server`      | `Handlers` (`make`, `flat`, `of`, `fromService`, `fromProcedures`), `toWebHandler`, `layerHttp` / `toHttpLayer`, `serializationLayer`, `createCaller`, `Middleware`; types `Caller`, `CallerOptions`, `CallOptions`, `PromiseCallOptions`, `WebHandler`, `ServerOptions`, `Serialization`, ... | `src/index.ts` → `src/Handlers.ts`, `src/Http.ts`, `src/Caller.ts`, `src/Middleware.ts` |
| `@effect-trpc/server/node` | `serve` (Layer), `runServer` (Promise); types `NodeServeOptions`, `RunningServer`                                                                                                                                                                                                              | `src/node.ts` (needs the optional peer `@effect/platform-node`)                         |

**Golden path**

```ts
import { Effect, Schema } from 'effect';
import { query, Router } from '@effect-trpc/core';
import { createCaller, Handlers, toWebHandler } from '@effect-trpc/server';

class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.Number,
}) {}

// 1. Router (usually in a module shared with the client).
export const appRouter = Router.make({
  post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
});

// 2. Handlers: a nested record mirroring the router. Merge middleware layers in with Layer.mergeAll.
const HandlersLive = Handlers.make(appRouter, {
  post: {
    byId: ({ id }) =>
      id === 1
        ? Effect.succeed(new Post({ id, title: 'Hello' }))
        : Effect.fail(new PostNotFound({ id })),
  },
});

// 3a. Serve over HTTP (fetch runtimes). `path` must equal the URL path of the route.
const { handler, dispose } = await toWebHandler(appRouter, {
  handlers: HandlersLive,
  path: '/rpc',
});

// 3b. Or call in-process.
const caller = createCaller(appRouter, { handlers: HandlersLive });
const post = await caller.$promise.post.byId({ id: 1 }); // Post instance
await caller.dispose();
await dispose();
```

**Golden path (router written once as an Effect service)**

```ts
import { Context, Effect, Layer, Schema } from 'effect';
import { Procedure, Router } from '@effect-trpc/core';
import { Handlers, toWebHandler } from '@effect-trpc/server';
// `Post` and `PostNotFound` as above.

class Database extends Context.Service<
  Database,
  { readonly findPost: (id: number) => Effect.Effect<Post, PostNotFound> }
>()('Database') {}

// Shared with the client: schemas and handlers together; services are read inside handlers.
export class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.succeed({
    post: {
      byId: Procedure.input({ id: Schema.Finite })
        .output(Post)
        .error(PostNotFound)
        .query(
          Effect.fn(function* ({ id }) {
            const db = yield* Database;
            return yield* db.findPost(id);
          }),
        ),
    },
  }),
}) {}

// Layer<Rpc.Handler<'post.byId'> | AppRouter, never, Database>: requirements inferred.
const ServiceHandlersLive = Handlers.fromService(AppRouter);
declare const DatabaseLive: Layer.Layer<Database>;
// Every adapter takes the class itself (normalised with `Router.from`).
await toWebHandler(AppRouter, {
  handlers: ServiceHandlersLive.pipe(Layer.provide(DatabaseLive)),
});
```

For a Node process use `runServer` / `serve` from `@effect-trpc/server/node` ([Node server](#node-server--effect-trpcservernode));
for auth see [Middleware and auth context](#middleware-and-auth-context).

**Invariants**

- Typed errors are `Schema.TaggedError` classes declared on the procedure (or middleware `error`); anything else a handler throws or dies with is a defect.
- Every HTTP endpoint is `protocol: "http"` (websocket only via `layerHttp({ protocol: 'websocket' })`) with `disableFatalDefects: true`; one defect never breaks later calls.
- Default serialization is `"ndjson"` for both protocols (the same default as `httpLink` / `wsLink`); if you override it, clients must use the same one.
- The server layer must provide `Handlers.Requirements<R>`: every handler plus every middleware implementation (`Layer.mergeAll(HandlersLive, AuthLive)`).
- Promise caller rejections are `ClientError<E> = E | RpcDefect | RpcTransportError | RpcInterrupted`; Effect caller calls fail with exactly `E`.
- Every function taking a `router` takes a `Router.Input` (a router or a router service class) and calls `Router.from` once; types are computed with `Router.Of<X>`, so a service and the equivalent `Router.make` router infer the same caller / handler types. Type helpers (`Caller<R>`, `Handlers.Requirements<R>`, ...) take a router type: `Router.Of<typeof AppRouter>`.
- `toWebHandler` / `runServer` build the handler layer eagerly (the promise rejects on failure); `createCaller` builds it on the first call.
- `$promise`, `$router` and `dispose` are reserved top-level keys on a caller: `createCaller` throws for a router that uses them.
- `Handlers.fromService` / `Handlers.fromProcedures` produce the same handler layer as `Handlers.make` (same tags) from the procedures' `handler`s; their requirements are the handlers' services minus `Scope` and middleware-provided services. `fromService` also provides the service (`yield* AppRouter` is exactly what that build's `make` produced; nested router services stay classes). It accepts a router service whose `make` reads services and fails: it runs `make` (and nested makes) with `Router.buildService` once per layer build, and adds `RouterService.MakeError` / `RouterService.MakeServices` (minus `Scope`) to the layer's error and requirements. A pure class already built by a sync API (`toWebHandler(AppRouter, …)`, `Router.from`) is reused instead of re-run.
- Every other API taking a router (`toWebHandler`, `serve` / `runServer`, `createCaller`, `layerHttp`, `Handlers.make` / `flat` / `of`) needs it synchronously: for a router service whose `make` reads services pass the contract (a schema-only `Router.make` router, normally `router.client.gen.ts`) and serve the class with `Handlers.fromService`.

**Common mistakes**

- Don't pass only `HandlersLive` when the router uses middleware → pass `Layer.mergeAll(HandlersLive, AuthLive)`.
- Don't mount `toWebHandler` at `/api/rpc` with the default `path` → set `path: '/api/rpc'` (other paths answer `404`).
- Don't return an un-annotated record from an `Effect` build → wrap it in `Handlers.of(router, {...})`.
- Don't throw or `Effect.die` for expected failures → `Effect.fail(new PostNotFound({ id }))` with a declared `Schema.TaggedError`.
- Don't use Effect v3 APIs (`Context.Tag`, `@effect/rpc`, `@effect/platform`) → `Context.Service`, `effect/rpc`, `effect/http`.
- Don't import `serve` / `runServer` from `@effect-trpc/server` → import from `@effect-trpc/server/node`.
- Don't forget `dispose()` on `toWebHandler`, `createCaller` and `runServer` results in tests → use `try/finally` or `await using`.
- Don't pass a router with `query({...})` definitions to `Handlers.fromService` / `fromProcedures` (compile error `procedure '<path>' has no handler ...`; throws if forced) → build them with `Procedure`, or implement the router with `Handlers.make`.
- Don't write `Caller<typeof AppRouter>` for a router service → `Caller<Router.Of<typeof AppRouter>>` (functions take the class directly; type helpers take a router type).
- Don't pass a router service whose `make` reads services (`yield* AppConfig`) to `toWebHandler`, `serve`, `createCaller` or `Handlers.make` → it is a compile error (a runtime error naming the fix if cast away); pass the contract (`router.client.gen.ts`) and give the class to `Handlers.fromService`.
- Don't expect a pure `make` that reads a `Context.Reference` to see a value provided to the `fromService` layer once a sync API built the class → it was memoized with the default; read such a service inside the handlers.
- Don't write `ReturnType<typeof Handlers.make>` (uninstantiated: TS2589 "excessively deep", because `Handlers.make` is overloaded for router services) → `Handlers.Provides<R>` / `Handlers.Services<R, H>` / `Handlers.Requirements<R>`, or the instantiated form `ReturnType<typeof Handlers.make<typeof appRouter, Handlers.From<typeof appRouter>>>`.
- Don't call `RpcServer.layerHttp` directly without `protocol: "http"` and `disableFatalDefects: true` → use `layerHttp` from this package.

**Where to look**

- `test/readme.test.ts` (this README's example), `test/handlers.test.ts` / `test/handlers.test-d.ts` (`Handlers`), `test/routerService.test.ts` / `test/routerService.test-d.ts` (`Handlers.fromService` / `fromProcedures`, fixtures in `test/service-fixtures.ts`), `test/routerServiceEffectful.test.ts` / `.test-d.ts` (a `make` that reads services), `test/web-handler.test.ts` (`toWebHandler`: errors, defects, NDJSON, path, dispose → 503), `test/node.test.ts` (`runServer`, `layerHttp` in an Effect app), `test/caller.test.ts` / `test/caller.test-d.ts` (`createCaller`, abort, dispose), `test/middlewares.test.ts` (ordering, provided services, middleware errors), `test/procedure-errors.test.ts` (typed errors vs defects), `test/streaming.test.ts`, `test/validation.test.ts`, `test/PARITY.md`.
- JSDoc on every export (`src/*.ts`) follows `docs/jsdoc-style.md`.

**Verify**

```sh
pnpm exec vp -C packages/server test
pnpm exec vp -C packages/server pack
node scripts/verify-jsdoc.mjs server
```

## Install

```bash
pnpm add @effect-trpc/server @effect-trpc/core effect
pnpm add @effect/platform-node # only for @effect-trpc/server/node
```

## Example

```ts
import { Context, Effect, Layer, Schema, Stream } from 'effect';
import { mutation, query, Router, subscription } from '@effect-trpc/core';
import { createCaller, Handlers, Middleware, toWebHandler } from '@effect-trpc/server';

class User extends Schema.Class<User>('User')({
  id: Schema.String,
  name: Schema.String,
  createdAt: Schema.Date,
}) {
  greet() {
    return `Hello, ${this.name}!`;
  }
}
class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { id: Schema.String }) {}
class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}

// --- Auth middleware: reads a header, provides CurrentUser to handlers -----------------------
class CurrentUser extends Context.Service<CurrentUser, { readonly name: string }>()(
  'CurrentUser',
) {}
class Auth extends Middleware.make<Auth, { provides: CurrentUser }>()('Auth', {
  error: Unauthorized,
}) {}

const AuthLive = Layer.succeed(Auth)(
  Auth.of((effect, { headers }) => {
    const name = headers['x-user'];
    return name === undefined
      ? Effect.fail(new Unauthorized())
      : Effect.provideService(effect, CurrentUser, { name });
  }),
);

// --- Router (from @effect-trpc/core) --------------------------------------------------------
const appRouter = Router.make({
  user: {
    byId: query({ payload: { id: Schema.String }, success: User, error: NotFound }),
    create: mutation({ payload: { name: Schema.String }, success: User }),
    me: query({ success: User }).middleware(Auth),
    list: subscription({ payload: { count: Schema.Number }, success: User }),
  },
});

// --- Handlers: a nested record mirroring the router -----------------------------------------
const HandlersLive = Handlers.make(appRouter, {
  user: {
    byId: ({ id }) =>
      id === 'ada'
        ? Effect.succeed(new User({ id, name: 'Ada', createdAt: new Date() }))
        : Effect.fail(new NotFound({ id })),
    create: ({ name }) => Effect.succeed(new User({ id: name, name, createdAt: new Date() })),
    me: () =>
      Effect.gen(function* () {
        const { name } = yield* CurrentUser; // provided by the Auth middleware
        return new User({ id: name, name, createdAt: new Date() });
      }),
    list: ({ count }) =>
      Stream.range(1, count).pipe(
        Stream.map((i) => new User({ id: `u${i}`, name: `User ${i}`, createdAt: new Date() })),
      ),
  },
});

// Handlers + server implementations of the router's middleware.
const ServerLive = Layer.mergeAll(HandlersLive, AuthLive);

// --- Fetch handler (Next.js route.ts, TanStack Start server route, Bun.serve, ...) ----------
const { handler, dispose } = await toWebHandler(appRouter, { handlers: ServerLive });
// export const POST = handler;   // Next.js App Router: app/rpc/route.ts
await dispose();

// --- In-process caller -----------------------------------------------------------------------
const caller = createCaller(appRouter, { handlers: ServerLive });

const ada = await caller.$promise.user.byId({ id: 'ada' }); // User instance
ada.greet(); // "Hello, Ada!"

const me = await caller.$promise.user.me(undefined, { headers: { 'x-user': 'grace' } });

try {
  await caller.$promise.user.byId({ id: 'nobody' });
} catch (error) {
  // ClientError<NotFound>: a NotFound instance, or RpcDefect / RpcTransportError / RpcInterrupted
}

// Effect API: typed errors, R = never
const program = caller.user
  .byId({ id: 'ada' })
  .pipe(Effect.catchTag('NotFound', () => Effect.succeed(null)));
for await (const user of caller.$promise.user.list({ count: 3 })) user.greet();

await caller.dispose();
```

## Handlers

`Handlers.make(router, build)` returns `Layer<Rpc.ToHandler<...>>` — the same layer
`router.group.toLayer(...)` would produce, so it works with `RpcServer`, `RpcTest.makeClient`,
`toWebHandler`, `createCaller`, ...

- Each handler is an `effect/rpc` handler: `(payload, ctx) => Effect` for queries and mutations,
  `(payload, ctx) => Stream` (or `Effect<Queue.Dequeue>`) for subscriptions.
- **Request info** lives in `ctx`: `ctx.headers` (HTTP request headers merged with the rpc
  message headers; per-call `headers` for the caller), `ctx.requestId`, `ctx.rpc`, `ctx.client`.
- `build` may be an `Effect` producing the record, for handlers that need services when the layer
  is built. Use `Handlers.of(router, {...})` inside it to keep contextual typing:

  ```ts
  const HandlersLive = Handlers.make(
    appRouter,
    Effect.gen(function* () {
      const db = yield* Database;
      return Handlers.of(appRouter, { user: { byId: ({ id }) => db.findUser(id) /* ... */ } });
    }),
  );
  ```

- Services a handler uses stay requirements of the layer, except those provided by middleware
  (such as `CurrentUser` above) and `Scope`.
- `Handlers.flat(router, { 'user.byId': ... })` accepts the tag-keyed form.
- Types: `Handlers.From<R>` (nested record), `Handlers.Flat<R>` (tag-keyed),
  `Handlers.Requirements<R>` (everything a server layer must provide: handlers + middleware).

## Routers as services (`Handlers.fromService`)

A router written once with `@effect-trpc/core`'s `Procedure` builder carries its handlers, so
there is no handler record to write:

- `Handlers.fromService(AppRouter)` takes a router service (a `Context.Service` class whose `make`
  returns `Procedure` procedures) and returns
  `Layer<Handlers.Provides<Router.Of<typeof AppRouter>> | AppRouter, RouterService.MakeError<typeof AppRouter>, Exclude<RouterService.MakeServices<typeof AppRouter>, Scope> | Handlers.ProcedureServices<...>>`:
  one handler per procedure plus the service itself, so `yield* AppRouter` returns exactly the
  record that build's `make` produced. `make` runs when the layer is built
  (`Router.buildService`), with the services you provide, once per build. If a pure class was
  already built by a sync API, that memoized router is reused and `make` does not run again.
- A `make` that reads services (`yield* AppConfig`) is served the same way, but the sync APIs
  below cannot run it: pass them the contract, a schema-only `Router.make` router (normally
  `router.client.gen.ts` from `@effect-trpc/codegen`). The layer's error and requirements then
  include what every `make` fails with and reads:

  ```ts
  const HandlersLive = Handlers.fromService(AppRouter); // requires AppConfig | Database
  const web = await toWebHandler(AppRouterContract, {
    handlers: HandlersLive.pipe(Layer.provide([AppConfigLive, DatabaseLive])),
  });
  ```

- `Handlers.fromProcedures(router)` does the same for a plain `Router.make` router of `Procedure`
  procedures (services nested in it included), without providing a service.
- Requirements are inferred from the handlers (`Effect` and `Stream` alike) minus `Scope` and the
  services the procedure's middleware provides, whether the middleware was added with the
  builder, on the finished procedure or with `router.middleware(M)` (in a router service: on a
  router nested in the `make` record, `admin: Router.make({...}).middleware(Auth)`; `make` itself
  must return a record, not a router).
- Middleware implementations are still separate layers:
  `Layer.mergeAll(Handlers.fromService(AppRouter), AuthLive)`.
- A procedure defined with `query` / `mutation` / `subscription({...})` has no handler. Both
  functions reject it at compile time (TypeScript reports a missing property named
  `procedure '<path>' has no handler ...`) and throw, naming every such path, if forced with a
  cast. Implement routers that mix both styles with `Handlers.make`.
- Adapters take the class too when its `make` reads no services: `toWebHandler`, `layerHttp`,
  `createCaller`, `serve` / `runServer` and `Handlers.make` / `flat` / `of` accept `AppRouter`
  directly (normalised with `Router.from`). Type helpers that take a router type take `Router.Of<typeof AppRouter>`
  (`Caller<Router.Of<typeof AppRouter>>`, `Handlers.Requirements<Router.Of<typeof AppRouter>>`).

```ts
const ServerLive = Layer.mergeAll(Handlers.fromService(AppRouter), AuthLive).pipe(
  Layer.provide(DatabaseLive),
);
const caller = createCaller(AppRouter, { handlers: ServerLive });
```

## Middleware and auth context

`Middleware` is `effect/rpc`'s `RpcMiddleware` module; `Middleware.make` is `RpcMiddleware.Service`.
A middleware declares its typed `error` (added to the error type of every procedure using it)
and the services it `provides` to handlers. The server implementation receives
`{ headers, payload, rpc, requestId, client }`. Attach middleware per procedure
(`query(...).middleware(Auth)`) or per router (`router.middleware(Auth)`). Middleware added later
wraps the middleware added before it, so it runs first.

Provide middleware implementations together with the handlers:
`Layer.mergeAll(HandlersLive, AuthLive)`. Missing implementations are compile errors for
`toWebHandler`, `createCaller` and `serve`. For `requiredForClient` middleware, `createCaller`
also needs the client implementation (`Middleware.layerClient`).

## Web handler

```ts
const { handler, dispose } = await toWebHandler(appRouter, {
  handlers: ServerLive,
  path: '/rpc', // default
  serialization: 'ndjson', // default; or 'json', or any RpcSerialization layer
});
```

The handler layer is built eagerly (the promise rejects if it fails) and shared by all requests
until `dispose()`, which interrupts in-flight requests (their `Exit` is an interruption), runs the
layer's finalizers and makes later requests answer `503`. Clients must use the same serialization (`RpcSerialization.layerNdjson` for
an `effect/rpc` client). For an existing Effect HTTP app use `layerHttp(appRouter, { handlers, path })`
(alias `toHttpLayer`), which needs an `HttpRouter`; `protocol: "websocket"` is also available there.

## Node server — `@effect-trpc/server/node`

```ts
import { Layer } from 'effect';
import { NodeRuntime } from '@effect/platform-node';
import { runServer, serve } from '@effect-trpc/server/node';

// As a Layer (long-running process)
Layer.launch(serve(appRouter, { handlers: ServerLive, port: 3000 })).pipe(NodeRuntime.runMain);

// As a Promise (tests, scripts); port 0 picks a free port
const server = await runServer(appRouter, { handlers: ServerLive, port: 0 });
server.url; // "http://localhost:54321/rpc"
await server.dispose();
```

Both accept `handlers`, `port`, `host`, `path`, `serialization` and `gracefulShutdownTimeout`
(how long shutdown waits for in-flight requests before interrupting them; platform default 20s for
`serve`, 1s for `runServer`). `@effect/platform-node` is an optional peer dependency used only by
this subpath; the main entry stays platform-neutral.

## Caller

`createCaller(router, { handlers })` returns a proxy mirroring the router:

| call                                                      | returns                                               |
| --------------------------------------------------------- | ----------------------------------------------------- |
| `caller.user.byId(input, { headers? })`                   | `Effect<User, NotFound>` (R = never)                  |
| `caller.user.list(input)` (subscription)                  | `Stream<User, E>`                                     |
| `caller.$promise.user.byId(input, { signal?, headers? })` | `Promise<User>`, rejects with `ClientError<NotFound>` |
| `caller.$promise.user.list(input, { signal? })`           | `AsyncIterable<User>`, throws `ClientError<E>`        |

Calls go through `RpcTest.makeClient` — no serialization, but middleware runs and headers reach
it. Aborting a `signal` interrupts the handler and rejects with `RpcInterrupted`; defects reject
with `RpcDefect`. Calling a path that is not a procedure throws. `caller.dispose()` interrupts
in-flight calls and releases the handler layer; later calls fail with `RpcInterrupted`.
`caller.$router` is the router. The keys `$promise`, `$router` and `dispose` are reserved on the
caller root, so avoid them as top-level router keys.
