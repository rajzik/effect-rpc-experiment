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
- **`Handlers.withContext` and the `onError` option** — `Handlers.withContext(handlers, context)`
  (tRPC's `createContext`) gives every HTTP adapter services computed per call; `onError` reports
  failed calls in one place. Handlers read the request and set response headers and cookies with
  `HttpContext` from `@effect-trpc/core`.
- **`@effect-trpc/server/node`** — `serve` (a Layer) and `runServer` (a Promise) on Node's `http`.

Every function that takes a `router` also takes a pure router service class (`toWebHandler(AppRouter,
...)`); it is normalised with `Router.from` once at the call. A service whose `make` reads services
goes to `Handlers.fromService`; the other functions take its contract (`router.client.gen.ts`).

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
- you add auth with `Middleware`, per-call services with `Handlers.withContext`, or central failure
  reporting with the `onError` option of the HTTP adapters.

Use a sibling instead to define procedures and routers (`@effect-trpc/core`), to call a server
from another process or the browser (`@effect-trpc/client`), or for React Query hooks
(`@effect-trpc/tanstack-react-query`).

**Entry points**

| import path                | exports                                                                                                                                                                                                                                                                                                                                       | source                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `@effect-trpc/server`      | `Handlers` (`make`, `flat`, `of`, `fromService`, `fromProcedures`, `withContext`), `toWebHandler`, `layerHttp` / `toHttpLayer`, `serializationLayer`, `createCaller`, `Middleware`; types `Caller`, `CallerOptions`, `CallOptions`, `PromiseCallOptions`, `WebHandler`, `ServerOptions` (`onError`, ...), `OnErrorInfo`, `Serialization`, ... | `src/index.ts` → `src/Handlers.ts`, `src/Http.ts`, `src/Caller.ts`, `src/Middleware.ts` |
| `@effect-trpc/server/node` | `serve` (Layer), `runServer` (Promise); types `NodeServeOptions`, `RunningServer`                                                                                                                                                                                                                                                             | `src/node.ts` (needs the optional peer `@effect/platform-node`)                         |

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

**Golden path (per-call context and failure reporting)**

```ts
import { Cause, Context, Effect, Option, Schema } from 'effect';
import { HttpContext, Procedure, Router } from '@effect-trpc/core';
import { Handlers, toWebHandler } from '@effect-trpc/server';
import type { OnErrorInfo } from '@effect-trpc/server';

class RequestId extends Context.Service<RequestId, string>()('RequestId') {}

const appRouter = Router.make({
  requestId: Procedure.output(Schema.String).query(() => RequestId),
});

// Evaluated once per call, before every middleware and the handler.
const context = Effect.map(HttpContext.request, (request) =>
  Context.make(
    RequestId,
    Option.match(request, {
      onNone: () => 'local',
      onSome: (req) => req.headers['x-request-id'] ?? crypto.randomUUID(),
    }),
  ),
);

const onError = ({ path, cause, headers }: OnErrorInfo) =>
  Effect.logError(
    `${path} failed (request ${headers['x-request-id'] ?? '-'})`,
    Cause.pretty(cause),
  );

// `RequestId` is a requirement of `fromProcedures`; `withContext` provides it per call.
const { handler } = await toWebHandler(appRouter, {
  handlers: Handlers.withContext(Handlers.fromProcedures(appRouter), context),
  onError,
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
- `Handlers.withContext(handlers, context)` takes `context: Effect<Context<C>, never, CR>` (required) and returns the handlers layer without the requirement `C`. Every HTTP adapter (`toWebHandler`, `layerHttp`, `serve`, `runServer`, the Next / Start adapters) evaluates `context` once per call (over WebSocket too) before every middleware and the handler, and provides its services to both. `CR` is read from the output of `handlers`; what it does not provide stays a requirement of the returned layer. It cannot fail with a typed error (use a middleware); a defect in it fails the call with `RpcDefect`. `createCaller` and `localLink` do not apply it.
- `onError({ path, cause, headers })` is called once for every call that fails while running (handler or middleware; typed failure or defect; a subscription failing mid-stream), before the failure is sent. It is not called for interruptions, nor for calls rejected outside the handler and middleware (invalid payload, unknown procedure, a success value that fails to encode: they reach the client as `RpcDefect`; tRPC's `BAD_REQUEST` input errors do reach its `onError`). It is awaited and uninterruptible; its own failures are ignored and never change the response.
- The HTTP adapters always add one internal middleware (outermost) for the request context and `onError`; without them it only runs the call.
- Response headers and cookies set with `HttpContext` (from `@effect-trpc/core`) apply when the response is written: with `ndjson` only if set before the first response chunk, with `json` until the last call of the request ends; the HTTP status cannot be set. Calls batched by `httpBatchLink` share one response.
- `$promise`, `$router` and `dispose` are reserved top-level keys on a caller: `createCaller` throws for a router that uses them.
- `Handlers.fromService` / `Handlers.fromProcedures` produce the same handler layer as `Handlers.make` (same tags) from the procedures' `handler`s; their requirements are the handlers' services minus `Scope` and middleware-provided services. `fromService` also provides the service (`yield* AppRouter` is exactly what that build's `make` produced; nested router services stay classes). It accepts a router service whose `make` reads services and fails: it runs `make` (and nested makes) with `Router.buildService` once per layer build, and adds `RouterService.MakeError` to the layer's error and `RouterService.MakeServices` to its requirements (only `Scope` is excluded from those; middleware-provided services are excluded from the handlers' requirements only).
- Every other API taking a router (`toWebHandler`, `serve` / `runServer`, `createCaller`, `layerHttp`, `Handlers.make` / `flat` / `of`) needs it synchronously: for a router service whose `make` reads services pass the contract (a schema-only `Router.make` router, normally `router.client.gen.ts`) and serve the class with `Handlers.fromService`.

**Common mistakes**

- Don't pass only `HandlersLive` when the router uses middleware → pass `Layer.mergeAll(HandlersLive, AuthLive)`.
- Don't mount `toWebHandler` at `/api/rpc` with the default `path` → set `path: '/api/rpc'` (other paths answer `404`).
- Don't return an un-annotated record from an `Effect` build → wrap it in `Handlers.of(router, {...})`.
- Don't throw or `Effect.die` for expected failures → `Effect.fail(new PostNotFound({ id }))` with a declared `Schema.TaggedError`.
- Don't use Effect v3 APIs (`Context.Tag`, `@effect/rpc`, `@effect/platform`) → `Context.Service`, `effect/rpc`, `effect/http`.
- Don't import `serve` / `runServer` from `@effect-trpc/server` → import from `@effect-trpc/server/node`.
- Don't forget `dispose()` on `toWebHandler`, `createCaller` and `runServer` results in tests → use `try/finally` or `await using`.
- Don't pass a router with `query({...})` definitions to `Handlers.fromService` / `fromProcedures` (compile error `procedure '<path>' has no handler ...`; if forced, `fromProcedures` throws and `fromService` dies when its layer is built) → build them with `Procedure`, or implement the router with `Handlers.make`.
- Don't write `Caller<typeof AppRouter>` for a router service → `Caller<Router.Of<typeof AppRouter>>` (functions take the class directly; type helpers take a router type).
- Don't pass a router service whose `make` reads services (`yield* AppConfig`) to `toWebHandler`, `serve`, `createCaller` or `Handlers.make` → it is a compile error (a runtime error naming the fix if cast away); pass the contract (`router.client.gen.ts`) and give the class to `Handlers.fromService`.
- Don't write `ReturnType<typeof Handlers.make>` (uninstantiated: TS2589 "excessively deep", because `Handlers.make` is overloaded for router services) → `Handlers.Provides<R>` / `Handlers.Services<R, H>` / `Handlers.Requirements<R>`, or the instantiated form `ReturnType<typeof Handlers.make<typeof appRouter, Handlers.From<typeof appRouter>>>`.
- Don't `yield*` a service in a handler without providing it → either a middleware `provides` it, `Handlers.withContext` provides it, or it is provided to the handlers layer; otherwise it is a requirement of the adapter (compile error).
- Don't fail the `withContext` effect to reject a call → it cannot fail with a typed error; reject in a middleware.
- Don't read a `withContext` service while the handlers layer is built (`Layer.effect(… yield* RequestId)`) → it exists only while a call runs; read it inside the handler.
- Don't give a `Handlers.withContext` layer to `createCaller` or `localLink` → they do not apply it (calls needing its services die); provide the services to the plain handlers layer.
- Don't rely on `onError` to see invalid payloads or unknown procedures → they reach the client as `RpcDefect` without calling it.
- Don't make `onError` slow or hanging → the failure is sent after it completes and it is not interrupted (a client abort does not stop it, and `dispose()` waits); fork long work.
- Don't call `HttpContext` setters per subscription element → set them before the first element, once.
- Don't call `RpcServer.layerHttp` directly without `protocol: "http"` and `disableFatalDefects: true` → use `layerHttp` from this package.

**Where to look**

- `test/readme.test.ts` (this README's example), `test/handlers.test.ts` / `test/handlers.test-d.ts` (`Handlers`), `test/routerService.test.ts` / `test/routerService.test-d.ts` (`Handlers.fromService` / `fromProcedures`, fixtures in `test/service-fixtures.ts`), `test/routerServiceEffectful.test.ts` / `.test-d.ts` (a `make` that reads services), `test/web-handler.test.ts` (`toWebHandler`: errors, defects, NDJSON, path, dispose → 503), `test/node.test.ts` (`runServer`, `layerHttp` in an Effect app), `test/caller.test.ts` / `test/caller.test-d.ts` (`createCaller`, abort, dispose), `test/middlewares.test.ts` (ordering, provided services, middleware errors), `test/context.test.ts` / `test/context.test-d.ts` (`Handlers.withContext` and its types), `test/onError.test.ts` (`onError`), `test/httpContext.test.ts` (`HttpContext` over HTTP, WebSocket and the caller), `test/annotate.test.ts` (annotations read by middleware), `test/procedure-errors.test.ts` (typed errors vs defects), `test/streaming.test.ts`, `test/validation.test.ts`, `test/PARITY.md`.
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
  (`Router.buildService`), with the services you provide, once per build.
- A `make` that reads services (`yield* AppConfig`) is served the same way, but the sync APIs
  below cannot run it: pass them the contract, a schema-only `Router.make` router (normally
  `router.client.gen.ts` from `@effect-trpc/codegen`, which checks at compile time that it still
  matches the class). A hand-written contract needs the same check
  (`Router.Rpcs<typeof Contract>` equal to `Router.Rpcs<typeof AppRouter>`): the server serves the
  contract's procedures, so one missing a `.middleware(Auth)` serves that procedure without `Auth`
  and no type asks for `AuthLive`. The layer's error and requirements include what every `make`
  fails with and reads:

  ```ts
  const HandlersLive = Handlers.fromService(AppRouter); // requires AppConfig | Database
  const web = await toWebHandler(AppRouterContract, {
    handlers: HandlersLive.pipe(Layer.provide([AppConfigLive, DatabaseLive])),
  });
  ```

  When a procedure's output is inferred (no `.output(...)`), pass the `AppRouter` of
  `router.gen.ts` (the class with the generated schemas) instead of the original class: the
  original keeps the inference guard, so such a handler dies when it returns a value.

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
  `procedure '<path>' has no handler ...`). If forced with a cast, both name every such path:
  `fromProcedures` throws, `fromService` dies when its layer is built. Implement routers that mix both styles with `Handlers.make`.
- Adapters take the class too when its `make` (and every nested service's `make`) is synchronous,
  reads no services and cannot fail (a `RouterService.Pure`): `toWebHandler`, `layerHttp`,
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

A procedure's metadata (tRPC's `meta`, `.annotate(Key, value)` in `@effect-trpc/core`) reaches the
server implementation as `rpc.annotations`: `Context.get(rpc.annotations, Key)`.

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

## Request context, response headers and `onError`

`Handlers.withContext(handlers, context)` is tRPC's `createContext`: `context` is an `Effect` of
services, evaluated once per call before every middleware and the handler, and provided to both.
The `handlers` layer may require them; the layer `withContext` returns does not. Read the request
with `HttpContext.request` inside it:

```ts
import { Context, Effect, Option } from 'effect';
import { HttpContext } from '@effect-trpc/core';

class RequestId extends Context.Service<RequestId, string>()('RequestId') {}

const context = Effect.map(HttpContext.request, (request) =>
  Context.make(
    RequestId,
    Option.match(request, {
      onNone: () => 'local',
      onSome: (req) => req.headers['x-request-id'] ?? crypto.randomUUID(),
    }),
  ),
);

const { handler } = await toWebHandler(appRouter, {
  handlers: Handlers.withContext(HandlersLive, context),
});
```

`onError({ path, cause, headers })` runs for every call that fails while running (a handler or
middleware, typed failure or defect), before the failure is sent; it is not called for
interruptions or for calls rejected outside the handler and middleware (invalid payload, unknown
procedure, success that fails to encode). `onError` is an option of `toWebHandler`, `layerHttp`,
`serve` and `runServer` here, and of `createRouteHandler` / `createStartHandler` in the Next.js and
Start packages; all of them apply a `Handlers.withContext` context. Handlers and middleware also use `HttpContext.setHeader`,
`appendHeader` and `setCookie` (from `@effect-trpc/core`) to change the response; with `ndjson`
only before the first response chunk.

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

Both accept `handlers`, `port`, `host`, `path`, `serialization`, `onError` and `gracefulShutdownTimeout`
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
