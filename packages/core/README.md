# @effect-trpc/core

tRPC-style routers and procedures for [Effect](https://effect.website) v4, compiled to a plain
[`effect/rpc`](https://effect.website) `RpcGroup`. This package holds the shared, transport-free
pieces of effect-trpc:

- **Procedure builders** — `query`, `mutation`, `subscription` — that describe a procedure with
  Effect Schemas (payload, success, error) and optional `RpcMiddleware`.
- **`Router.make`** — nests procedures (and other routers) into a record; tags are the dot-joined
  paths (`"post.byId"`), with literal types computed at the type level.
- **The client error model** — `ClientError<E>` keeps your typed errors separate from
  infrastructure failures (`RpcDefect`, `RpcTransportError`, `RpcInterrupted`).
- **`Codecs`** — memoized JSON codecs for an rpc's payload, success, error and `Exit`, so
  `Schema.Class` and `Schema.TaggedError` instances survive any JSON boundary (SSR hydration,
  server actions, caches).

Servers, clients and the TanStack Query bridge live in `@effect-trpc/server`,
`@effect-trpc/client` and `@effect-trpc/tanstack-react-query`.

## Install

```bash
pnpm add @effect-trpc/core effect
```

## Defining a router

```ts
import { Effect, Schema, Stream } from 'effect';
import { RpcMiddleware } from 'effect/rpc';
import { mutation, query, Router, subscription } from '@effect-trpc/core';
import type { inferError, inferInput, inferOutput } from '@effect-trpc/core';

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

(`@effect-trpc/server` adds nested handler records, HTTP/fetch adapters and an in-process caller.)

### Router API

| API                                         | Description                                                                                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Router.make(record)`                       | Compile a nested record of procedures / routers / records. Throws on keys containing `"."`, empty keys and the reserved keys `then`, `call`, `apply`. |
| `router.group`                              | `RpcGroup<Router.Rpcs<typeof record>>` — tags are dot-joined paths.                                                                                   |
| `router.procedures`                         | `ReadonlyMap<tag, { path, tag, kind, rpc }>` in definition order.                                                                                     |
| `router.record`                             | The original record (nested routers kept as-is).                                                                                                      |
| `router.middleware(M)`                      | New router with `M` applied to every procedure (after per-procedure middleware).                                                                      |
| `Router.merge(a, b)`                        | Merge two routers; overlapping top-level keys throw.                                                                                                  |
| `Router.getByPath(router, ['post','byId'])` | `Option<ProcedureInfo>`.                                                                                                                              |
| `Router.getRpc(router, 'post.byId')`        | The compiled rpc, precisely typed (`Rpc<"post.byId", …>`).                                                                                            |
| `Router.isRouter(u)` / `isProcedureDef(u)`  | Guards.                                                                                                                                               |

Type helpers: `Router.Rpcs<R>`, `Router.Paths<R>` (`"health" | "post.byId" | …`),
`Router.Record<R>`, `inferInput` / `inferOutput` / `inferError` / `inferKind` for a procedure
(subscription output is the element type; middleware errors are included in `inferError`), and
`inferRouterInputs` / `inferRouterOutputs` / `inferRouterErrors` for nested maps of a whole router.

Every compiled rpc carries a `ProcedureKind` annotation:
`Context.get(rpc.annotations, ProcedureKind) // "query" | "mutation" | "subscription"`.
Subscriptions compile to `Rpc.make(tag, { stream: true, … })`.

## The ClientError model

A client call for a procedure with error type `E` can fail with exactly:

```ts
type ClientError<E> = E | RpcDefect | RpcTransportError | RpcInterrupted;
```

| Error               | `_tag`                           | When                                                                             |
| ------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| `E`                 | your tags                        | the handler failed with a declared error — the **same instance** (decoded class) |
| `RpcDefect`         | `@effect-trpc/RpcDefect`         | the handler died / threw, or a response could not be decoded (`cause` = defect)  |
| `RpcTransportError` | `@effect-trpc/RpcTransportError` | network / HTTP / protocol failure (`cause` = the `effect/rpc` `RpcClientError`)  |
| `RpcInterrupted`    | `@effect-trpc/RpcInterrupted`    | the call was aborted or interrupted                                              |

Domain errors are never disguised as infrastructure errors and vice versa. All three
infrastructure errors are `Schema.TaggedError`s (their `cause` uses `Schema.Defect`), so they can
be serialized too.

```ts
import { Exit } from 'effect';
import { RpcTest } from 'effect/rpc';
import { causeToClientError, isClientInfrastructureError } from '@effect-trpc/core';

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
import { Codecs, Router } from '@effect-trpc/core';

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
