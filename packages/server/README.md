# @effect-trpc/server

Serve an [`@effect-trpc/core`](../core) router with [Effect](https://effect.website) v4. Built
directly on `effect/rpc` (`RpcServer`, `RpcGroup.toLayer`, `RpcTest`), it adds the tRPC-shaped
pieces:

- **`Handlers.make(router, nested)`** — implement procedures with a record that mirrors the router
  (`{ post: { byId: ({ id }, ctx) => Effect } }`). Missing handlers and wrong payload / success /
  error types are compile errors.
- **`toWebHandler(router, { handlers })`** — a fetch handler (`Request → Response`) for Next.js,
  TanStack Start, Bun, Deno, Cloudflare, Hono, ...
- **`layerHttp(router, { handlers })`** — the same endpoint as an Effect `HttpRouter` layer, to
  compose into an existing Effect HTTP app.
- **`createCaller(router, { handlers })`** — an in-process typed caller (tRPC's `createCaller`):
  Effect and Promise APIs, middleware included, no serialization.
- **`Middleware`** — `effect/rpc`'s `RpcMiddleware` plus `Middleware.make` for auth/context.
- **`@effect-trpc/server/node`** — `serve` (a Layer) and `runServer` (a Promise) on Node's `http`.

Every HTTP endpoint uses `protocol: "http"` and `disableFatalDefects: true`: typed failures and
defects are encoded into that call's `Exit` and later calls keep working. `Schema.Class` results
and `Schema.TaggedError` failures are encoded with their schemas, so clients receive real
instances (methods, `Date` fields, `instanceof`).

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
