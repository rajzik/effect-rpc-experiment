/**
 * Implements a router's procedures as an `effect/rpc` handler layer.
 *
 * `Handlers.make` takes a nested record mirroring the `@effect-trpc/core` router record and
 * flattens it into `router.group.toLayer(...)`, so the resulting `Layer<Rpc.ToHandler<...>>` plugs
 * into everything that serves an `RpcGroup`: {@link toWebHandler}, `layerHttp`,
 * `@effect-trpc/server/node`, `createCaller`, `RpcServer` and `RpcTest.makeClient`.
 *
 * @since 0.1.0
 */
import { Effect } from 'effect';
import type { Layer, Scope, Stream } from 'effect';
import type { Rpc, RpcGroup } from 'effect/rpc';
import type { ProcedureDef, Router } from '@effect-trpc/core';

type RecordOf<R> = R extends Router<infer Rec> ? Rec : R;

type NestedFrom<Rec, Prefix extends string> = {
  readonly [K in keyof Rec & string]: Rec[K] extends ProcedureDef.Any
    ? Rpc.ToHandlerFn<ProcedureDef.ToRpc<Rec[K], `${Prefix}${K}`>>
    : NestedFrom<RecordOf<Rec[K]>, `${Prefix}${K}.`>;
};

type ResultServices<Result> =
  Result extends Rpc.Wrapper<infer Inner>
    ? ResultServices<Inner>
    : Result extends Effect.Effect<infer _A, infer _E, infer R>
      ? R
      : Result extends Stream.Stream<infer _A, infer _E, infer R>
        ? R
        : never;

type HandlerServices<Current extends Rpc.Any, Handler> =
  Current extends Rpc.Rpc<
    infer Tag,
    infer _Payload,
    infer _Success,
    infer _Error,
    infer _Middleware,
    infer Requires
  >
    ?
        | Exclude<
            Rpc.ExcludeProvides<
              Handler extends (...args: ReadonlyArray<never>) => infer Result
                ? ResultServices<Result>
                : never,
              Current,
              Tag
            >,
            Scope.Scope
          >
        | Requires
    : never;

type NestedServices<Rec, H, Prefix extends string> = {
  [K in keyof H & string]: K extends keyof Rec
    ? Rec[K] extends ProcedureDef.Any
      ? HandlerServices<ProcedureDef.ToRpc<Rec[K], `${Prefix}${K}`>, H[K]>
      : NestedServices<RecordOf<Rec[K]>, H[K], `${Prefix}${K}.`>
    : never;
}[keyof H & string];

/**
 * Type-level helpers of {@link Handlers}: the handler record shapes and the services a server
 * layer must provide.
 *
 * @category type-level
 * @since 0.1.0
 */
export declare namespace Handlers {
  /**
   * The nested handler record of a router: it mirrors the router record, and every procedure maps
   * to an `effect/rpc` handler function `(payload, ctx) => Effect | Stream`, where
   * `ctx = { client, requestId, headers, rpc }`.
   *
   * Queries and mutations return an `Effect` of the success value; subscriptions return a
   * `Stream` of elements (or an `Effect` of a `Queue.Dequeue`).
   *
   * @since 0.1.0
   */
  export type From<R extends Router.Any> = NestedFrom<R['record'], ''>;

  /**
   * The tag-keyed handler record (`{ "post.byId": (payload, ctx) => ... }`), as accepted by
   * `Handlers.flat` and `router.group.toLayer`.
   *
   * @since 0.1.0
   */
  export type Flat<R extends Router.Any> = RpcGroup.HandlersFrom<Router.Rpcs<R>>;

  /**
   * The services required by a nested handler record `H` for router `R`, excluding the services
   * provided by middleware (e.g. `CurrentUser`) and `Scope`.
   *
   * @since 0.1.0
   */
  export type Services<R extends Router.Any, H> = NestedServices<R['record'], H, ''>;

  /**
   * The handler services a router needs: one `Rpc.Handler<Tag>` per procedure. This is what
   * `Handlers.make` provides.
   *
   * @since 0.1.0
   */
  export type Provides<R extends Router.Any> = Rpc.ToHandler<Router.Rpcs<R>>;

  /**
   * Everything an rpc server for router `R` needs from the environment: the handlers, the server
   * implementations of the router's middleware and the services required by its schemas.
   * Annotate a server layer with it: `Layer.Layer<Handlers.Requirements<AppRouter>>`.
   *
   * @since 0.1.0
   */
  export type Requirements<R extends Router.Any> =
    | Rpc.ToHandler<Router.Rpcs<R>>
    | Rpc.Middleware<Router.Rpcs<R>>
    | Rpc.ServicesServer<Router.Rpcs<R>>;
}

type AnyHandler = (...args: ReadonlyArray<never>) => unknown;

const isRecord = (u: unknown): u is { readonly [key: string]: unknown } =>
  typeof u === 'object' && u !== null;

/**
 * Converts a nested handler record to the tag-keyed record expected by `RpcGroup.toLayer`.
 * Throws when a procedure has no handler.
 */
const flatten = (router: Router.Any, nested: unknown): { readonly [tag: string]: AnyHandler } => {
  const out: { [tag: string]: AnyHandler } = {};
  for (const info of router.procedures.values()) {
    let node: unknown = nested;
    for (const segment of info.path) {
      node = isRecord(node) && Object.hasOwn(node, segment) ? node[segment] : undefined;
    }
    if (typeof node !== 'function') {
      throw new Error(`Missing handler for procedure "${info.tag}"`);
    }
    out[info.tag] = node as AnyHandler;
  }
  return out;
};

/** Flattens a nested record, or an Effect producing one (a missing handler is then a defect). */
const flattenBuild = (router: Router.Any, build: unknown): unknown =>
  Effect.isEffect(build)
    ? Effect.flatMap(build, (nested) =>
        Effect.try({ try: () => flatten(router, nested), catch: (cause) => cause }).pipe(
          Effect.orDie,
        ),
      )
    : flatten(router, build);

const toLayer = (router: Router.Any, handlers: unknown): Layer.Layer<never, unknown, unknown> =>
  (
    router.group as unknown as {
      readonly toLayer: (build: unknown) => Layer.Layer<never, unknown, unknown>;
    }
  ).toLayer(handlers);

/**
 * Implements every procedure of a router from a nested handler record mirroring the router
 * record, returning the handler layer (`Layer<Rpc.ToHandler<...>>`) consumed by `RpcServer`,
 * `RpcTest.makeClient`, `toWebHandler`, `createCaller`, ...
 *
 * **When to use**
 *
 * Use to implement a router. Pass an `Effect` producing the record (wrapped in `Handlers.of`)
 * when handlers need services at construction time. Prefer `Handlers.flat` when the record is
 * already tag-keyed.
 *
 * **Details**
 *
 * - Each handler receives the decoded payload and the `effect/rpc` handler context
 *   `{ client, requestId, headers, rpc }`. `headers` are the HTTP request headers merged with
 *   the rpc message headers (per-call `headers` for a caller).
 * - Fail with the procedure's `Schema.TaggedError` to produce a typed error; `Effect.die` and
 *   thrown exceptions are defects (`RpcDefect` on the client).
 * - Services used by handlers stay requirements of the layer, except those provided by
 *   middleware (e.g. `CurrentUser`) and `Scope`.
 *
 * **Gotchas**
 *
 * - A missing handler or a handler with the wrong payload / success / error type is a compile
 *   error. At runtime a missing handler throws (or fails the layer when `build` is an Effect).
 * - The returned layer does not include middleware implementations; merge them in:
 *   `Layer.mergeAll(HandlersLive, AuthLive)`.
 *
 * **Example** (Implementing a router)
 *
 * ```ts
 * import { Effect, Schema, Stream } from 'effect';
 * import { query, Router, subscription } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 *   countdown: subscription({ payload: { from: Schema.Number }, success: Schema.Number }),
 * });
 *
 * const HandlersLive = Handlers.make(appRouter, {
 *   post: {
 *     byId: ({ id }, { headers }) =>
 *       id === 1
 *         ? Effect.succeed(new Post({ id, title: headers['x-title'] ?? 'Hello' }))
 *         : Effect.fail(new PostNotFound({ id })),
 *   },
 *   countdown: ({ from }) => Stream.range(0, from).pipe(Stream.map((i) => from - i)),
 * });
 * ```
 */
const make = <R extends Router.Any, H extends Handlers.From<R>, EX = never, RX = never>(
  router: R,
  build: H | Effect.Effect<H, EX, RX>,
): Layer.Layer<Handlers.Provides<R>, EX, Exclude<RX, Scope.Scope> | Handlers.Services<R, H>> =>
  toLayer(router, flattenBuild(router, build)) as Layer.Layer<
    Handlers.Provides<R>,
    EX,
    Exclude<RX, Scope.Scope> | Handlers.Services<R, H>
  >;

/**
 * Implements every procedure of a router from a tag-keyed handler record
 * (`{ "post.byId": ... }`). Equivalent to `router.group.toLayer(handlers)`.
 *
 * **When to use**
 *
 * Use when handlers are keyed by procedure tag (the dot-joined router path), e.g. when porting
 * code written against `effect/rpc` directly. Prefer `Handlers.make` for new code.
 *
 * **Example** (Tag-keyed handlers)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 *
 * const appRouter = Router.make({
 *   post: { title: query({ payload: { id: Schema.Number }, success: Schema.String }) },
 * });
 *
 * const HandlersLive = Handlers.flat(appRouter, {
 *   'post.title': ({ id }) => Effect.succeed(`Post #${id}`),
 * });
 * ```
 */
const flat = <R extends Router.Any, H extends Handlers.Flat<R>, EX = never, RX = never>(
  router: R,
  build: H | Effect.Effect<H, EX, RX>,
): Layer.Layer<
  Handlers.Provides<R>,
  EX,
  Exclude<RX, Scope.Scope> | RpcGroup.HandlersServices<Router.Rpcs<R>, H>
> =>
  toLayer(router, build) as Layer.Layer<
    Handlers.Provides<R>,
    EX,
    Exclude<RX, Scope.Scope> | RpcGroup.HandlersServices<Router.Rpcs<R>, H>
  >;

/**
 * Identity helper that type-checks (and contextually types) a nested handler record against a
 * router, e.g. to define handlers in a separate module or inside `Effect.gen`.
 *
 * **When to use**
 *
 * Use inside the `Effect` passed to `Handlers.make`, where TypeScript cannot otherwise infer
 * the payload types of the returned record.
 *
 * **Example** (Building handlers from a service)
 *
 * ```ts
 * import { Context, Effect, Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 *
 * class Greeting extends Context.Service<Greeting, { readonly word: string }>()('Greeting') {}
 *
 * const appRouter = Router.make({
 *   greet: query({ payload: { name: Schema.String }, success: Schema.String }),
 * });
 *
 * // Layer<Rpc.Handler<'greet'>, never, Greeting>
 * const HandlersLive = Handlers.make(
 *   appRouter,
 *   Effect.gen(function* () {
 *     const { word } = yield* Greeting;
 *     return Handlers.of(appRouter, { greet: ({ name }) => Effect.succeed(`${word}, ${name}`) });
 *   }),
 * );
 * ```
 */
const of = <R extends Router.Any, H extends Handlers.From<R>>(_router: R, handlers: H): H =>
  handlers;

/**
 * Handler constructors for a core `Router`: `make` (nested record), `flat` (tag-keyed record)
 * and `of` (contextual typing helper).
 *
 * **When to use**
 *
 * Use `Handlers.make(router, record)` to implement a router; pass the resulting layer, merged
 * with the middleware implementations, to `toWebHandler`, `layerHttp`, `createCaller` or
 * `@effect-trpc/server/node`.
 *
 * **Details**
 *
 * - The layer is the one `router.group.toLayer(...)` would produce
 *   (`Layer<Rpc.ToHandler<...>>`), so it also works with plain `effect/rpc` (`RpcServer`,
 *   `RpcTest.makeClient`) and with `localLink` from `@effect-trpc/client`.
 * - `Handlers.make` accepts the record or an `Effect` producing it; an `Effect` build runs when
 *   the layer is built, and finalizers it adds run when the layer is released.
 *
 * **Gotchas**
 *
 * - Inside an `Effect` build, wrap the record in `Handlers.of(router, {...})`, otherwise the
 *   payload parameters are not contextually typed.
 * - Middleware implementations are separate layers; a server needs
 *   `Layer.mergeAll(HandlersLive, AuthLive)`, checked against `Handlers.Requirements<R>`.
 *
 * **Example** (Handlers that need a service and an auth middleware)
 *
 * ```ts
 * import { Context, Effect, Layer, Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { Handlers, Middleware } from '@effect-trpc/server';
 *
 * class User extends Schema.Class<User>('User')({ id: Schema.String, name: Schema.String }) {}
 * class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { id: Schema.String }) {}
 * class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}
 *
 * class Database extends Context.Service<
 *   Database,
 *   { readonly findUser: (id: string) => Effect.Effect<User, NotFound> }
 * >()('Database') {}
 * class CurrentUser extends Context.Service<CurrentUser, { readonly id: string }>()(
 *   'CurrentUser',
 * ) {}
 * class Auth extends Middleware.make<Auth, { provides: CurrentUser }>()('Auth', {
 *   error: Unauthorized,
 * }) {}
 *
 * const appRouter = Router.make({
 *   user: {
 *     byId: query({ payload: { id: Schema.String }, success: User, error: NotFound }),
 *     me: query({ success: User, error: NotFound }).middleware(Auth),
 *   },
 * });
 *
 * const HandlersLive = Handlers.make(
 *   appRouter,
 *   Effect.gen(function* () {
 *     const db = yield* Database;
 *     return Handlers.of(appRouter, {
 *       user: {
 *         byId: ({ id }) => db.findUser(id),
 *         me: () =>
 *           Effect.gen(function* () {
 *             const { id } = yield* CurrentUser; // provided by Auth, not a layer requirement
 *             return yield* db.findUser(id);
 *           }),
 *       },
 *     });
 *   }),
 * );
 *
 * const AuthLive = Layer.succeed(Auth)(
 *   Auth.of((effect, { headers }) => {
 *     const id = headers['x-user'];
 *     return id === undefined
 *       ? Effect.fail(new Unauthorized())
 *       : Effect.provideService(effect, CurrentUser, { id });
 *   }),
 * );
 * declare const DatabaseLive: Layer.Layer<Database>;
 *
 * // Everything a server for `appRouter` needs.
 * const ServerLive: Layer.Layer<Handlers.Requirements<typeof appRouter>> = Layer.mergeAll(
 *   HandlersLive,
 *   AuthLive,
 * ).pipe(Layer.provide(DatabaseLive));
 * ```
 *
 * @see {@link Handlers.Requirements}
 * @category handlers
 * @since 0.1.0
 */
export const Handlers = {
  make,
  flat,
  of,
} as const;
