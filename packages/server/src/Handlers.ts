/**
 * Implements a router's procedures as an `effect/rpc` handler layer.
 *
 * `Handlers.make` takes a nested record mirroring the `@effect-trpc/core` router record and
 * flattens it into `router.group.toLayer(...)`, so the resulting `Layer<Rpc.ToHandler<...>>` plugs
 * into everything that serves an `RpcGroup`: {@link toWebHandler}, `layerHttp`,
 * `@effect-trpc/server/node`, `createCaller`, `RpcServer` and `RpcTest.makeClient`.
 * `Handlers.fromService` / `Handlers.fromProcedures` build the same layer from the handlers of
 * procedures written with `@effect-trpc/core`'s `Procedure` builder (a router service or a plain
 * router), inferring their requirements.
 *
 * @since 0.1.0
 */
import { Effect, Layer } from 'effect';
import type { Context, Scope, Stream } from 'effect';
import type { Rpc, RpcGroup } from 'effect/rpc';
import { Procedure, Router } from '@effect-trpc/core';
import type { ProcedureDef, ProcedureWithHandler, RouterService } from '@effect-trpc/core';

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

type HandlerOf<D> = D extends { readonly handler: infer H } ? H : never;

type NestedProcedureServices<Rec, Prefix extends string> = {
  [K in keyof Rec & string]: Rec[K] extends ProcedureDef.Any
    ? HandlerServices<ProcedureDef.ToRpc<Rec[K], `${Prefix}${K}`>, HandlerOf<Rec[K]>>
    : NestedProcedureServices<RecordOf<Rec[K]>, `${Prefix}${K}.`>;
}[keyof Rec & string];

type NestedWithoutHandler<Rec, Prefix extends string> = {
  [K in keyof Rec & string]: Rec[K] extends ProcedureDef.Any
    ? Rec[K] extends ProcedureWithHandler.Any
      ? never
      : `${Prefix}${K}`
    : NestedWithoutHandler<RecordOf<Rec[K]>, `${Prefix}${K}.`>;
}[keyof Rec & string];

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

  /**
   * The services required by the handlers of a router built with `Procedure` (what
   * `Handlers.fromProcedures` / `Handlers.fromService` leave as layer requirements): the union
   * of every handler's requirements, minus `Scope` and the services the procedure's middleware
   * provides (e.g. `CurrentUser`).
   *
   * @since 0.1.0
   */
  export type ProcedureServices<R extends Router.Any> = NestedProcedureServices<R['record'], ''>;

  /**
   * The paths of the procedures of router `R` that have no handler (defined with
   * `query` / `mutation` / `subscription({...})` instead of `Procedure`); `never` when every
   * procedure has one.
   *
   * @since 0.1.0
   */
  export type WithoutHandler<R extends Router.Any> = NestedWithoutHandler<R['record'], ''>;

  /**
   * The compile error of `Handlers.fromService` / `Handlers.fromProcedures` for procedures
   * without a handler: one property per path, whose name is the message. It is intersected with
   * the argument type, so TypeScript reports
   * `Property "procedure 'user.byId' has no handler ..." is missing in type ...`.
   *
   * @since 0.1.0
   */
  export type ProceduresWithoutHandler<Paths extends string> = {
    readonly [
      P in Paths as `procedure '${P}' has no handler (defined with query/mutation/subscription({...})): build it with Procedure (e.g. Procedure.input(...).query(handler)), or implement the router with Handlers.make`
    ]: P;
  };

  /**
   * `unknown` when every procedure of router `R` has a handler, otherwise
   * {@link ProceduresWithoutHandler} naming the paths that have none.
   *
   * @since 0.1.0
   */
  export type RequireHandlers<R extends Router.Any> = [WithoutHandler<R>] extends [never]
    ? unknown
    : ProceduresWithoutHandler<WithoutHandler<R>>;
}

type AnyHandler = (...args: ReadonlyArray<never>) => unknown;

const isHandler = (u: unknown): u is AnyHandler => typeof u === 'function';

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
    if (!isHandler(node)) {
      throw new Error(`Missing handler for procedure "${info.tag}"`);
    }
    out[info.tag] = node;
  }
  return out;
};

type FlatHandlers = { readonly [tag: string]: AnyHandler };

/** Narrows `build` to its Effect branch; a handler record is never an Effect. */
const isBuildEffect = <H, EX, RX>(
  build: H | Effect.Effect<H, EX, RX>,
): build is Effect.Effect<H, EX, RX> => Effect.isEffect(build);

/** Flattens a nested record, or an Effect producing one (a missing handler is then a defect). */
const flattenBuild = <H, EX, RX>(
  router: Router.Any,
  build: H | Effect.Effect<H, EX, RX>,
): FlatHandlers | Effect.Effect<FlatHandlers, EX, RX> =>
  isBuildEffect(build)
    ? Effect.flatMap(build, (nested) => Effect.sync(() => flatten(router, nested)))
    : flatten(router, build);

/**
 * `RpcGroup#toLayer` with its handler type erased; the caller states the layer type it restores.
 */
const toLayer = <A, E, R>(router: Router.Any, handlers: unknown): Layer.Layer<A, E, R> => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- deliberate erasure: the public `make` / `flat` signatures type-check the handlers against the router (`H extends Handlers.From<R>` / `Handlers.Flat<R>`), which fixes the provided handlers, error and services named by `A`, `E`, `R`
  const group = router.group as unknown as {
    readonly toLayer: (build: unknown) => Layer.Layer<A, E, R>;
  };
  return group.toLayer(handlers);
};

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
  toLayer<Handlers.Provides<R>, EX, Exclude<RX, Scope.Scope> | Handlers.Services<R, H>>(
    router,
    flattenBuild(router, build),
  );

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
  toLayer<
    Handlers.Provides<R>,
    EX,
    Exclude<RX, Scope.Scope> | RpcGroup.HandlersServices<Router.Rpcs<R>, H>
  >(router, build);

/** The definition at `path` of a resolved router record (nested routers and plain records). */
const procedureAt = (router: Router.Any, path: ReadonlyArray<string>): unknown => {
  let node: unknown = router;
  for (const segment of path) {
    if (Router.isRouter(node)) node = node.record;
    node = isRecord(node) && Object.hasOwn(node, segment) ? node[segment] : undefined;
  }
  return node;
};

/**
 * The tag-keyed handlers of a router built with `Procedure`. Throws, naming every path, when a
 * procedure has no handler.
 */
const proceduresHandlers = (router: Router.Any, owner: string): FlatHandlers => {
  const out: { [tag: string]: AnyHandler } = {};
  const missing: Array<string> = [];
  for (const info of router.procedures.values()) {
    const def = procedureAt(router, info.path);
    if (Procedure.hasHandler(def)) out[info.tag] = def.handler;
    else missing.push(`"${info.tag}"`);
  }
  if (missing.length > 0) {
    throw new Error(
      `${owner} has procedures without a handler: ${missing.join(', ')} (defined with query/mutation/subscription({...})). Build them with Procedure (e.g. Procedure.input(...).query(handler)), or implement the router with Handlers.make`,
    );
  }
  return out;
};

/**
 * Implements a router whose procedures were built with `Procedure` (schemas + handler) from the
 * procedures' own handlers: no handler record to write.
 *
 * **When to use**
 *
 * Use for a plain router (`Router.make`) of `Procedure` procedures. For a router written as an
 * Effect service use {@link Handlers.fromService}, which also provides the service.
 *
 * **Details**
 *
 * - The layer is the one `Handlers.make` would produce for the same handlers (same tags,
 *   same `Layer<Rpc.ToHandler<...>>`); services nested in the router contribute their handlers.
 * - Requirements are inferred ({@link Handlers.ProcedureServices}): the union of the handlers'
 *   requirements minus `Scope` and the services provided by the procedure's middleware, whether
 *   it was added with the builder, on the procedure or with `router.middleware(M)`.
 *
 * **Gotchas**
 *
 * - A procedure defined with `query` / `mutation` / `subscription({...})` has no handler: that
 *   is a compile error naming its path ({@link Handlers.ProceduresWithoutHandler}) and, if
 *   forced with a cast, throws. Implement such routers with `Handlers.make` (a builder
 *   procedure's `handler` can be reused there).
 * - Middleware implementations are separate layers: `Layer.mergeAll(HandlersLive, AuthLive)`.
 *
 * **Example** (A plain router of builder procedures)
 *
 * ```ts
 * import { Context, Effect, Layer, Schema } from 'effect';
 * import { Procedure, Router } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 *
 * class Greeting extends Context.Service<Greeting, { readonly word: string }>()('Greeting') {}
 *
 * const appRouter = Router.make({
 *   greet: Procedure.input({ name: Schema.String })
 *     .output(Schema.String)
 *     .query(({ name }) => Effect.map(Greeting, ({ word }) => `${word}, ${name}`)),
 * });
 *
 * // Layer<Rpc.Handler<'greet'>, never, Greeting>
 * const HandlersLive = Handlers.fromProcedures(appRouter).pipe(
 *   Layer.provide(Layer.succeed(Greeting)({ word: 'Hello' })),
 * );
 * ```
 */
const fromProcedures = <R extends Router.Any>(
  router: R & Handlers.RequireHandlers<R>,
): Layer.Layer<Handlers.Provides<R>, never, Handlers.ProcedureServices<R>> =>
  toLayer<Handlers.Provides<R>, never, Handlers.ProcedureServices<R>>(
    router,
    proceduresHandlers(router, 'Handlers.fromProcedures: the router'),
  );

/**
 * Implements a router written as an Effect service (a `Context.Service` class whose `make`
 * returns `Procedure` procedures) from the procedures' own handlers, and provides the service
 * itself.
 *
 * **When to use**
 *
 * Use to serve a router service: pass the layer, merged with the middleware implementations
 * and provided with the services the handlers read, to `toWebHandler`, `layerHttp`,
 * `createCaller` or `@effect-trpc/server/node`.
 *
 * **Details**
 *
 * - The router is `Router.fromService(Svc)`: `make` is evaluated once per class per process,
 *   shared with every other API that uses the class.
 * - The layer provides one `Rpc.Handler<Tag>` per procedure (tags as `Router.make` assigns them)
 *   and `Svc`, so `yield* Svc` returns the procedures record (`Router.from(Svc).record`).
 * - Requirements are inferred ({@link Handlers.ProcedureServices}): the union of the handlers'
 *   requirements minus `Scope` and middleware-provided services (e.g. `CurrentUser`).
 *
 * **Gotchas**
 *
 * - A procedure defined with `query` / `mutation` / `subscription({...})` inside the service
 *   is a compile error naming its path; if forced with a cast it throws. Use `Handlers.make`
 *   for routers mixing both styles.
 * - A `make` that needs services is a compile error; an async or failing `make` throws the
 *   error of `Router.fromService`.
 * - A router service nested in `make` is provided as its resolved router
 *   (`Router.from(Nested)`), not as the class.
 *
 * **Example** (Serving a router service)
 *
 * ```ts
 * import { Context, Effect, Layer, Schema } from 'effect';
 * import { Procedure, Router } from '@effect-trpc/core';
 * import { Handlers, toWebHandler } from '@effect-trpc/server';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Finite, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Finite,
 * }) {}
 * class Database extends Context.Service<
 *   Database,
 *   { readonly findPost: (id: number) => Effect.Effect<Post, PostNotFound> }
 * >()('Database') {}
 *
 * class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
 *   make: Effect.succeed({
 *     post: {
 *       byId: Procedure.input({ id: Schema.Finite })
 *         .output(Post)
 *         .error(PostNotFound)
 *         .query(
 *           Effect.fn(function* ({ id }) {
 *             const db = yield* Database; // read services inside handlers
 *             return yield* db.findPost(id);
 *           }),
 *         ),
 *     },
 *   }),
 * }) {}
 *
 * declare const DatabaseLive: Layer.Layer<Database>;
 *
 * // Layer<Rpc.Handler<'post.byId'> | AppRouter, never, Database>
 * const HandlersLive = Handlers.fromService(AppRouter);
 *
 * const web = await toWebHandler(Router.from(AppRouter), {
 *   handlers: HandlersLive.pipe(Layer.provide(DatabaseLive)),
 * });
 * ```
 */
const fromService = <S extends RouterService.Any>(
  service: S & Handlers.RequireHandlers<Router.Of<S>>,
): Layer.Layer<
  Handlers.Provides<Router.Of<S>> | Context.Service.Identifier<S>,
  never,
  Handlers.ProcedureServices<Router.Of<S>>
> => {
  const router: Router.Any = Router.fromService(service);
  const handlers = toLayer<
    Handlers.Provides<Router.Of<S>>,
    never,
    Handlers.ProcedureServices<Router.Of<S>>
  >(
    router,
    proceduresHandlers(router, `Handlers.fromService: the router service "${service.key}"`),
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a service key's identifier is its class (`Context.Service.Identifier<S>`); `RouterService.Any` erases it to `any`
  const key = service as unknown as Context.Key<Context.Service.Identifier<S>, Router.Shape>;
  return Layer.merge(handlers, Layer.succeed(key)(router.record));
};

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
 * Handler constructors for a core `Router`: `make` (nested record), `flat` (tag-keyed record),
 * `of` (contextual typing helper), and `fromService` / `fromProcedures` (routers whose
 * procedures were built with `Procedure` and carry their handlers).
 *
 * **When to use**
 *
 * Use `Handlers.make(router, record)` to implement a router of `query` / `mutation` /
 * `subscription({...})` definitions, `Handlers.fromService(AppRouter)` for a router written as
 * an Effect service with `Procedure`; pass the resulting layer, merged
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
  fromProcedures,
  fromService,
} as const;
