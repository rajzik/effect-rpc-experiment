/**
 * Compiles nested records of procedure definitions into a tRPC-style `Router`.
 *
 * A router is a thin, frozen wrapper around an `effect/rpc` `RpcGroup` whose tags are the
 * dot-joined record paths (`"post.byId"`). `@effect-trpc/server` implements `router.group`,
 * `@effect-trpc/client` builds a nested proxy from `router.procedures`, and the type helpers here
 * (`inferRouterInputs`, `Router.Paths`, ...) give tRPC-style inference over the whole tree.
 *
 * A router can also be written as an Effect `Context.Service` whose `make` returns the record (a
 * router service, see {@link RouterService}). `Router.from` turns either form into a `Router`, so
 * every API that takes a router takes the service class too.
 *
 * @since 0.1.0
 */
import { Cause, Context, Effect, Exit, Fiber, Option, Predicate } from 'effect';
import { RpcGroup } from 'effect/rpc';
import type { Rpc, RpcMiddleware } from 'effect/rpc';
import { addDefMiddleware, compileDef, isProcedureDef } from './Procedure.js';
import type { inferError, inferInput, inferOutput, ProcedureDef } from './Procedure.js';
import type { ProcedureKind } from './ProcedureKind.js';

const TypeId = '~@effect-trpc/core/Router' as const;

/** Router keys that would break proxy-based clients (thenable detection, `Function.prototype`). */
const reservedKeys: ReadonlySet<string> = new Set(['then', 'call', 'apply']);

/**
 * Metadata about one procedure of a router.
 *
 * **When to use**
 *
 * Read it from `router.procedures` (keyed by tag) or {@link Router.getByPath} when you need the
 * path, kind or compiled rpc of a procedure at runtime — e.g. to build a client proxy, generate
 * docs or pick an HTTP method per kind.
 *
 * **Example** (Listing the mutations of a router)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { mutation, query, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   health: query({ success: Schema.Literal('ok') }),
 *   post: {
 *     byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }),
 *     create: mutation({ payload: { title: Schema.String }, success: Post }),
 *   },
 * });
 *
 * const mutations = [...appRouter.procedures.values()]
 *   .filter((info) => info.kind === 'mutation')
 *   .map((info) => info.tag); // ["post.create"]
 * ```
 *
 * @see {@link Router}
 * @category models
 * @since 0.1.0
 */
export interface ProcedureInfo {
  /** Path segments in the router record, e.g. `["post", "byId"]`. */
  readonly path: ReadonlyArray<string>;
  /** The rpc tag: the path joined by `"."`, e.g. `"post.byId"`. */
  readonly tag: string;
  /** `"query"`, `"mutation"` or `"subscription"`. */
  readonly kind: ProcedureKind.Value;
  /** The compiled `effect/rpc` rpc (annotated with `ProcedureKind`). */
  readonly rpc: Rpc.AnyWithProps;
}

/**
 * A tRPC-style router: a nested record of procedure definitions (and other routers) compiled to
 * an `effect/rpc` `RpcGroup` whose tags are the dot-joined record paths.
 *
 * **When to use**
 *
 * Create one with {@link Router.make} and export its type for clients
 * (`export type AppRouter = typeof appRouter`). Pass the router itself to `@effect-trpc/server`
 * (`Handlers.make`, `createCaller`, `toWebHandler`) and `@effect-trpc/client` (`createClient`).
 *
 * **Details**
 *
 * - `group` is an ordinary `RpcGroup`, so every `effect/rpc` API (`group.toLayer`,
 *   `RpcServer`, `RpcClient`, `RpcTest.makeClient`) works with it directly.
 * - Routers are frozen; `router.middleware(M)` returns a new router.
 *
 * **Example** (Using the compiled group with effect/rpc)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 *
 * export const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post }) },
 * });
 * export type AppRouter = typeof appRouter;
 *
 * // handlers are keyed by the dot-joined tag
 * const HandlersLive = appRouter.group.toLayer({
 *   'post.byId': ({ id }) => Effect.succeed(new Post({ id, title: 'Hello' })),
 * });
 * ```
 *
 * @see {@link Router.make}
 * @category models
 * @since 0.1.0
 */
export interface Router<Rec> {
  readonly [TypeId]: typeof TypeId;
  /** The record the router was made from. Nested router values are kept as-is. */
  readonly record: Rec;
  /** The compiled group. Use it with `RpcServer`, `RpcClient`, `RpcTest`, `group.toLayer`, ... */
  readonly group: RpcGroup.RpcGroup<Router.Rpcs<Rec>>;
  /** Procedure metadata keyed by tag, in definition order. */
  readonly procedures: ReadonlyMap<string, ProcedureInfo>;
  /** Returns a new router with `middleware` applied to every procedure (after their own middleware). */
  middleware<M extends RpcMiddleware.AnyService>(
    middleware: M,
  ): Router<Router.WithMiddleware<Rec, M>>;
}

/**
 * Types related to {@link Router}.
 *
 * @category type-level
 * @since 0.1.0
 */
export declare namespace Router {
  /**
   * A router record: procedure definitions, routers, router services or nested records, keyed by
   * path segment. `Router.make` resolves router services to routers, so `router.record` never
   * holds one.
   *
   * @since 0.1.0
   */
  export type Shape = {
    readonly [key: string]: ProcedureDef.Any | Any | RouterService.Any | Shape;
  };

  /**
   * What every API that takes a router accepts: a router (`Router.make`) or a router service class
   * (see {@link RouterService}). Normalise it with `Router.from`.
   *
   * @since 0.1.0
   */
  export type Input = Any | RouterService.Any;

  /**
   * The router type of a {@link Input}: a router stays as it is, a router service maps to the
   * router built from its `make` (what `Router.from` / `Router.fromService` return).
   *
   * @since 0.1.0
   */
  export type Of<X> = X extends RouterService.Any
    ? Router<ServiceRecord<X>>
    : X extends Any
      ? X
      : never;

  /**
   * Any router (use it to constrain generic helpers: `<R extends Router.Any>`).
   *
   * @since 0.1.0
   */
  export interface Any {
    readonly [TypeId]: typeof TypeId;
    readonly record: Shape;
    readonly group: RpcGroup.Any;
    readonly procedures: ReadonlyMap<string, ProcedureInfo>;
  }

  /**
   * The record of a router type (for a router service, the record of the router built from it).
   *
   * @since 0.1.0
   */
  export type Record<R> = R extends RouterService.Any
    ? ServiceRecord<R>
    : R extends Router<infer Rec>
      ? Rec
      : never;

  /**
   * The union of `Rpc`s a router, router service or router record compiles to, with literal tags
   * such as `"post.byId"`. Use with `Rpc.ExtractTag`, `RpcClient.RpcClient` and other `effect/rpc`
   * types.
   *
   * @since 0.1.0
   */
  export type Rpcs<R> = R extends RouterService.Any
    ? RpcsOf<ServiceRecord<R>, ''>
    : R extends Any
      ? RpcsOf<R['record'], ''>
      : R extends Shape
        ? RpcsOf<Resolve<R>, ''>
        : never;

  /**
   * The union of procedure tags (dot-joined paths) of a router, router service or router record, e.g.
   * `"health" | "post.byId"`.
   *
   * @since 0.1.0
   */
  export type Paths<R> = TagOf<Rpcs<R>>;

  /**
   * Maps every procedure definition in a record (recursively) to the definition with `M` added
   * (the record type of `router.middleware(M)`).
   *
   * @since 0.1.0
   */
  export type WithMiddleware<Rec, M extends RpcMiddleware.AnyService> = {
    readonly [K in keyof Rec]: Rec[K] extends ProcedureDef.Any
      ? ProcedureDef.AddMiddleware<Rec[K], M>
      : Rec[K] extends Router<infer Sub>
        ? Router<WithMiddleware<Sub, M>>
        : WithMiddleware<Rec[K], M>;
  };

  /**
   * The record produced by merging two records with disjoint keys (see `Router.merge`).
   *
   * @since 0.1.0
   */
  export type Merge<A, B> = {
    readonly [K in keyof A | keyof B]: K extends keyof A ? A[K] : K extends keyof B ? B[K] : never;
  };
}

/**
 * Router services: a router written as an Effect `Context.Service` class whose `make` succeeds with
 * the router record.
 *
 * **When to use**
 *
 * Use {@link RouterService.Any} to constrain code that takes a router service, or
 * {@link Router.Input} for code that takes a router or a router service. Write the service itself
 * with the ordinary `Context.Service<Self>()(id, { make })`; there is no factory to learn.
 *
 * **Details**
 *
 * - `make` must be an `Effect` value (not a function) that needs no services and cannot fail:
 *   read services inside the handlers instead. A `make` that needs services or may fail does not
 *   satisfy {@link RouterService.Any}, so every API rejects it at compile time.
 * - Every API builds the router with `Router.fromService`, which runs `make` once per class.
 *
 * **Example** (A router service)
 *
 * ```ts
 * import { Context, Effect, Schema } from 'effect';
 * import { Procedure, Router } from '@effect-trpc/core';
 * import type { RouterService } from '@effect-trpc/core';
 *
 * export class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
 *   make: Effect.succeed({
 *     health: Procedure.output(Schema.Literal('ok')).query(() => Effect.succeed('ok' as const)),
 *   }),
 * }) {}
 *
 * const service: RouterService.Any = AppRouter;
 * const paths: Router.Paths<typeof AppRouter> = 'health';
 * ```
 *
 * @see {@link Router.fromService}
 * @category type-level
 * @since 0.1.0
 */
export declare namespace RouterService {
  /**
   * Any router service: a `Context` service class whose static `make` is an
   * `Effect<Router.Shape, never, never>` (no requirements, no failure).
   *
   * @since 0.1.0
   */
  export type Any = Context.Key<any, any> & {
    readonly make: Effect.Effect<Router.Shape>;
  };
}

/** The record of the router built from a router service (nested services resolved). */
type ServiceRecord<S> = S extends { readonly make: Effect.Effect<infer Rec, infer _E, infer _R> }
  ? Resolve<Rec>
  : never;

/**
 * The record type `Router.make` stores: router services (at any depth of plain records) replaced
 * by the routers built from them. Records without services are returned unchanged.
 */
type Resolve<Rec> = string extends keyof Rec
  ? Rec
  : true extends HasService<Rec>
    ? { readonly [K in keyof Rec]: ResolveEntry<Rec[K]> }
    : Rec;

type ResolveEntry<V> = [V] extends [RouterService.Any]
  ? Router<ServiceRecord<V>>
  : [V] extends [ProcedureDef.Any | Router.Any]
    ? V
    : Resolve<V>;

type HasService<Rec> = { readonly [K in keyof Rec]-?: EntryHasService<Rec[K]> }[keyof Rec];

type EntryHasService<V> = [V] extends [RouterService.Any]
  ? true
  : [V] extends [ProcedureDef.Any | Router.Any]
    ? false
    : string extends keyof V
      ? false
      : HasService<V>;

type RecordOf<R> = R extends RouterService.Any
  ? ServiceRecord<R>
  : R extends Router<infer Rec>
    ? Rec
    : R;

type InferField<
  D extends ProcedureDef.Any,
  F extends 'input' | 'output' | 'error',
> = F extends 'input' ? inferInput<D> : F extends 'output' ? inferOutput<D> : inferError<D>;

type MapRouter<Rec, F extends 'input' | 'output' | 'error'> = {
  readonly [K in keyof Rec]: Rec[K] extends ProcedureDef.Any
    ? InferField<Rec[K], F>
    : MapRouter<RecordOf<Rec[K]>, F>;
};

/**
 * The inputs of every procedure of a router, as a nested object mirroring the record
 * (tRPC's `inferRouterInputs`).
 *
 * **When to use**
 *
 * Use in client code that must not import server modules: derive types from
 * `typeof appRouter` (or an exported `AppRouter` type) instead of re-declaring them.
 *
 * **Example** (Typing a form from the router)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { mutation, query, Router } from '@effect-trpc/core';
 * import type {
 *   inferRouterErrors,
 *   inferRouterInputs,
 *   inferRouterOutputs,
 * } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   health: query({ success: Schema.Literal('ok') }),
 *   post: {
 *     byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }),
 *     create: mutation({ payload: { title: Schema.String }, success: Post }),
 *   },
 * });
 *
 * type RouterInputs = inferRouterInputs<typeof appRouter>;
 * type ByIdInput = RouterInputs['post']['byId']; // { readonly id: number }
 * type HealthInput = RouterInputs['health']; // void
 * ```
 *
 * @see {@link inferInput}
 * @category type-level
 * @since 0.1.0
 */
export type inferRouterInputs<R> = MapRouter<RecordOf<R>, 'input'>;
/**
 * The outputs of every procedure of a router, as a nested object mirroring the record
 * (tRPC's `inferRouterOutputs`; subscription outputs are the element type).
 *
 * **Example** (Typing a component prop from the router)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { mutation, query, Router } from '@effect-trpc/core';
 * import type {
 *   inferRouterErrors,
 *   inferRouterInputs,
 *   inferRouterOutputs,
 * } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   health: query({ success: Schema.Literal('ok') }),
 *   post: {
 *     byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }),
 *     create: mutation({ payload: { title: Schema.String }, success: Post }),
 *   },
 * });
 *
 * type RouterOutputs = inferRouterOutputs<typeof appRouter>;
 * type ByIdOutput = RouterOutputs['post']['byId']; // Post
 * ```
 *
 * @see {@link inferOutput}
 * @category type-level
 * @since 0.1.0
 */
export type inferRouterOutputs<R> = MapRouter<RecordOf<R>, 'output'>;
/**
 * The typed errors of every procedure of a router, as a nested object mirroring the record
 * (middleware errors included; infrastructure errors excluded).
 *
 * **Example** (Typing an error handler from the router)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { mutation, query, Router } from '@effect-trpc/core';
 * import type {
 *   inferRouterErrors,
 *   inferRouterInputs,
 *   inferRouterOutputs,
 * } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   health: query({ success: Schema.Literal('ok') }),
 *   post: {
 *     byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }),
 *     create: mutation({ payload: { title: Schema.String }, success: Post }),
 *   },
 * });
 *
 * type RouterErrors = inferRouterErrors<typeof appRouter>;
 * type ByIdError = RouterErrors['post']['byId']; // PostNotFound
 * type CreateError = RouterErrors['post']['create']; // never
 * ```
 *
 * @see {@link inferError}
 * @category type-level
 * @since 0.1.0
 */
export type inferRouterErrors<R> = MapRouter<RecordOf<R>, 'error'>;

type TagOf<R> = R extends { readonly _tag: infer Tag extends string } ? Tag : never;

type RpcsOf<Rec, Prefix extends string> = {
  [K in keyof Rec & string]: Rec[K] extends ProcedureDef.Any
    ? ProcedureDef.ToRpc<Rec[K], `${Prefix}${K}`>
    : Rec[K] extends Router.Any
      ? RpcsOf<Rec[K]['record'], `${Prefix}${K}.`>
      : Rec[K] extends Router.Shape
        ? RpcsOf<Rec[K], `${Prefix}${K}.`>
        : never;
}[keyof Rec & string];

/**
 * Returns `true` when `u` is a router created by `Router.make` (a plain record is not a router).
 *
 * **Example** (Telling routers and records apart)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { mutation, query, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   health: query({ success: Schema.Literal('ok') }),
 *   post: {
 *     byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }),
 *     create: mutation({ payload: { title: Schema.String }, success: Post }),
 *   },
 * });
 *
 * Router.isRouter(appRouter); // true
 * Router.isRouter(appRouter.record); // false
 * ```
 *
 * @category guards
 * @since 0.1.0
 */
const isRouter = (u: unknown): u is Router.Any =>
  Predicate.hasProperty(u, TypeId) && u[TypeId] === TypeId;

const isPlainRecord = (u: unknown): u is Router.Shape => {
  if (typeof u !== 'object' || u === null || Array.isArray(u)) return false;
  const proto: unknown = Object.getPrototypeOf(u);
  return proto === Object.prototype || proto === null;
};

/**
 * Returns `true` when `u` is a router service: a `Context` service class (see
 * {@link RouterService}) whose static `make` is an `Effect`.
 *
 * **When to use**
 *
 * Use in code that takes a {@link Router.Input} and must tell a router service from a router.
 * Most code calls {@link from} instead, which handles both.
 *
 * **Details**
 *
 * - Checks the shape only: whether `make` succeeds synchronously with a record is checked when the
 *   router is built ({@link fromService}).
 * - A service without `make`, a router, a record or a procedure is not a router service.
 *
 * **Example** (Telling services and routers apart)
 *
 * ```ts
 * import { Context, Effect, Schema } from 'effect';
 * import { Procedure, Router } from '@effect-trpc/core';
 *
 * class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
 *   make: Effect.succeed({
 *     health: Procedure.output(Schema.String).query(() => Effect.succeed('ok')),
 *   }),
 * }) {}
 * class Database extends Context.Service<Database, { readonly url: string }>()('Database') {}
 *
 * Router.isService(AppRouter); // true
 * Router.isService(Database); // false: no make
 * Router.isService(Router.fromService(AppRouter)); // false: a router
 * ```
 *
 * @see {@link fromService}
 * @category guards
 * @since 0.1.0
 */
const isService = (u: unknown): u is RouterService.Any =>
  Context.isKey(u) && Predicate.hasProperty(u, 'make') && Effect.isEffect(u.make);

const serviceRouters = new WeakMap<RouterService.Any, Router.Any>();
const resolving = new Set<RouterService.Any>();

const serviceError = (svc: RouterService.Any, rule: string, cause?: unknown): Error =>
  new Error(
    `Cannot build a router from the router service "${svc.key}": ${rule}`,
    cause === undefined ? undefined : { cause },
  );

const runMake = (svc: RouterService.Any): unknown => {
  const exit = Effect.runSyncExit(svc.make);
  if (Exit.isSuccess(exit)) return exit.value;
  const cause = Cause.squash(exit.cause);
  // `runSyncExit` leaves an asynchronous `make` running: stop it so it has no later effects.
  if (Cause.isAsyncFiberError(cause)) Effect.runFork(Fiber.interrupt(cause.fiber));
  throw serviceError(
    svc,
    'make must not require services or be asynchronous, and must not fail (read services inside the procedure handlers instead)',
    cause,
  );
};

/**
 * Builds the router of a router service: runs its `make` synchronously and compiles the record
 * with {@link make}.
 *
 * **When to use**
 *
 * Every API that takes a {@link Router.Input} calls it (through {@link from}), so you rarely call
 * it yourself; use it when you need the `Router` value of a service, e.g. for
 * {@link getRpc} or `router.group`.
 *
 * **Details**
 *
 * - Memoized per class: `make` runs once per process, however many APIs use the service, and
 *   every call returns the same router.
 * - Nested router services (in the record `make` returns) are resolved the same way.
 *
 * **Gotchas**
 *
 * - `make` must be an `Effect<Record, never, never>`: a `make` that needs services or may fail is a
 *   compile error. A `make` that is asynchronous (e.g. sleeps), or that fails or reads a service
 *   despite its type, throws an `Error` naming the service key and the rule
 *   ("make must not require services or be asynchronous"), with the Effect failure as `cause`.
 * - A failed `make` is not memoized: the next call runs it again.
 *
 * **Example** (Getting the router of a service)
 *
 * ```ts
 * import { Context, Effect, Schema } from 'effect';
 * import { Procedure, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 *
 * class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
 *   make: Effect.succeed({
 *     post: {
 *       byId: Procedure.input({ id: Schema.Number })
 *         .output(Post)
 *         .query(({ id }) => Effect.succeed(new Post({ id, title: 'Hello' }))),
 *     },
 *   }),
 * }) {}
 *
 * const router = Router.fromService(AppRouter);
 * router.procedures.get('post.byId')?.kind; // "query"
 * Router.fromService(AppRouter) === router; // true: memoized
 * ```
 *
 * @see {@link from}
 * @see {@link isService}
 * @category constructors
 * @since 0.1.0
 */
const fromService = <S extends RouterService.Any>(service: S): Router.Of<S> => {
  let router = serviceRouters.get(service);
  if (router === undefined) {
    if (resolving.has(service)) {
      throw serviceError(service, 'its make nests the service itself (directly or indirectly)');
    }
    resolving.add(service);
    try {
      const record = runMake(service);
      if (!isPlainRecord(record)) {
        throw serviceError(service, 'make must succeed with a record of procedures');
      }
      router = build(record);
    } finally {
      resolving.delete(service);
    }
    serviceRouters.set(service, router);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the router is built from `service.make`'s record, which is what `Router.Of<S>` describes
  return router as unknown as Router.Of<S>;
};

/**
 * Normalises a {@link Router.Input} to a router: returns a router unchanged and builds the router
 * of a router service with {@link fromService}.
 *
 * **When to use**
 *
 * Call it once at the entry of any API that accepts a router (`createClient`, `toWebHandler`, an
 * adapter of your own) so the rest of the code only deals with `Router`.
 *
 * **Details**
 *
 * - Typed as `Router.Of<X>`: the exact router type for a router, the built router type for a
 *   service. In generic code (`<R extends Router.Input>`) the result is assignable to
 *   `Router.Any`.
 *
 * **Gotchas**
 *
 * - Throws a `TypeError` for anything else (e.g. a plain record: wrap it in `Router.make`).
 *
 * **Example** (Accepting a router or a router service)
 *
 * ```ts
 * import { Context, Effect, Schema } from 'effect';
 * import { Procedure, query, Router } from '@effect-trpc/core';
 *
 * class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
 *   make: Effect.succeed({
 *     health: Procedure.output(Schema.String).query(() => Effect.succeed('ok')),
 *   }),
 * }) {}
 * const legacyRouter = Router.make({ health: query({ success: Schema.String }) });
 *
 * const tagsOf = <R extends Router.Input>(input: R): ReadonlyArray<string> => [
 *   ...Router.from(input).procedures.keys(),
 * ];
 *
 * tagsOf(AppRouter); // ["health"]
 * tagsOf(legacyRouter); // ["health"]
 * ```
 *
 * @see {@link fromService}
 * @category constructors
 * @since 0.1.0
 */
const from = <const X extends Router.Input>(input: X): Router.Of<X> => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a router is its own `Router.Of`
  if (isRouter(input)) return input as unknown as Router.Of<X>;
  if (isService(input)) return fromService(input) as Router.Of<X>;
  throw new TypeError(
    'Router.from: expected a router (Router.make) or a router service (a Context.Service class whose make returns procedures)',
  );
};

const validateKey = (key: string, path: ReadonlyArray<string>): void => {
  const where = path.length === 0 ? 'the router root' : `"${path.join('.')}"`;
  if (key.length === 0) {
    throw new Error(`Invalid router key at ${where}: keys must be non-empty`);
  }
  if (key.includes('.')) {
    throw new Error(
      `Invalid router key "${key}" at ${where}: keys must not contain "." (nest records instead)`,
    );
  }
  if (reservedKeys.has(key)) {
    throw new Error(`Invalid router key "${key}" at ${where}: "${key}" is reserved`);
  }
};

const collect = (
  record: Router.Shape,
  prefix: ReadonlyArray<string>,
  procedures: Map<string, ProcedureInfo>,
): void => {
  for (const key of Object.keys(record)) {
    validateKey(key, prefix);
    const value: unknown = record[key];
    const path = [...prefix, key];
    if (isProcedureDef(value)) {
      const tag = path.join('.');
      const rpc = compileDef(value, tag);
      procedures.set(tag, { path: Object.freeze(path), tag, kind: value.kind, rpc });
    } else if (isRouter(value)) {
      collect(value.record, path, procedures);
    } else if (isPlainRecord(value)) {
      collect(value, path, procedures);
    } else {
      throw new Error(
        `Invalid router entry at "${path.join('.')}": expected a procedure (query, mutation, subscription, Procedure), a router, a router service or a nested record`,
      );
    }
  }
};

const applyMiddleware = (
  record: Router.Shape,
  middleware: RpcMiddleware.AnyService,
): Router.Shape => {
  const out: { [key: string]: ProcedureDef.Any | Router.Any | Router.Shape } = {};
  for (const key of Object.keys(record)) {
    const value: unknown = record[key];
    if (isProcedureDef(value)) {
      out[key] = addDefMiddleware(value, middleware);
    } else if (isRouter(value)) {
      out[key] = build(applyMiddleware(value.record, middleware));
    } else if (isPlainRecord(value)) {
      out[key] = applyMiddleware(value, middleware);
    }
  }
  return out;
};

/**
 * Replaces router services (at any depth of plain records) by the routers built from them. Returns
 * `record` itself when it holds no service, so routers made from ordinary records keep them as-is.
 */
const resolveRecord = (record: Router.Shape): Router.Shape => {
  let out:
    | { [key: string]: ProcedureDef.Any | Router.Any | RouterService.Any | Router.Shape }
    | undefined;
  for (const key of Object.keys(record)) {
    const value: unknown = record[key];
    const resolved = isService(value)
      ? fromService(value)
      : isPlainRecord(value)
        ? resolveRecord(value)
        : value;
    if (resolved !== value) {
      out ??= { ...record };
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `resolved` is a router or a resolved record here (it differs from `value`)
      out[key] = resolved as Router.Any | Router.Shape;
    }
  }
  return out ?? record;
};

/** Compiles a record into a router (untyped core of `make`). */
const build = (input: Router.Shape): Router<Router.Shape> => {
  const record = resolveRecord(input);
  const procedures = new Map<string, ProcedureInfo>();
  collect(record, [], procedures);
  const group = RpcGroup.make(...Array.from(procedures.values(), (info) => info.rpc));
  const router: Router<Router.Shape> = {
    [TypeId]: TypeId,
    record,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the group is compiled from `record`, so its rpcs are `Router.Rpcs<Rec>`
    group: group as unknown as RpcGroup.RpcGroup<Router.Rpcs<Router.Shape>>,
    procedures,
    middleware: <M extends RpcMiddleware.AnyService>(middleware: M) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `applyMiddleware` adds `M` to every definition, which is what `WithMiddleware` describes
      build(applyMiddleware(record, middleware)) as unknown as Router<
        Router.WithMiddleware<Router.Shape, M>
      >,
  };
  return Object.freeze(router);
};

/**
 * Creates a router from a nested record of procedure definitions, routers and records.
 *
 * **When to use**
 *
 * Use once per API surface (usually one `appRouter` module shared by server and client). Nest
 * plain records for namespaces and embed other routers to compose feature modules; use
 * {@link merge} to combine two routers side by side.
 *
 * **Details**
 *
 * - Tags are the record paths joined by `"."` (`post.byId`), computed as literal types too.
 * - Procedures are compiled in definition order; `router.procedures` and `router.group.requests`
 *   keep that order.
 * - Every compiled rpc is annotated with `ProcedureKind`.
 * - The same definition may appear under several paths; nested routers are not mutated.
 * - A router service (see {@link RouterService}) may be an entry: it is resolved with
 *   {@link fromService}, and `router.record` (and its type) holds the resolved router there, so
 *   every type helper sees an ordinary nested router. A record without services is stored as-is.
 *
 * **Gotchas**
 *
 * - Throws if a key is empty, contains `"."` (nest records instead), is a reserved word (`then`,
 *   `call`, `apply` — they would break proxy-based clients) or if a value is not a procedure,
 *   router, router service or plain record.
 * - A router service entry whose `make` needs services or may fail is a compile error.
 *
 * **Example** (A nested app router)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { mutation, query, Router, subscription } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const adminRouter = Router.make({ stats: { count: query({ success: Schema.Number }) } });
 *
 * export const appRouter = Router.make({
 *   health: query({ success: Schema.Literal('ok') }),
 *   post: {
 *     byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }),
 *     create: mutation({ payload: { title: Schema.String }, success: Post }),
 *     onCreated: subscription({ success: Post }),
 *   },
 *   admin: adminRouter, // tags: "admin.stats.count"
 * });
 * export type AppRouter = typeof appRouter;
 *
 * type Paths = Router.Paths<AppRouter>;
 * // "health" | "post.byId" | "post.create" | "post.onCreated" | "admin.stats.count"
 * ```
 *
 * @see {@link merge}
 * @category constructors
 * @since 0.1.0
 */
const make = <const Rec extends Router.Shape>(record: Rec): Router<Resolve<Rec>> =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `build` resolves the services in `record`, which is what `Resolve` describes
  build(record) as unknown as Router<Resolve<Rec>>;

/**
 * Merges two routers into one (tRPC's `mergeRouters`).
 *
 * **When to use**
 *
 * Use to combine feature routers at the top level. To mount a router under a prefix, embed it
 * in a record instead: `Router.make({ admin: adminRouter })`.
 *
 * **Gotchas**
 *
 * - Top-level keys must be disjoint; a shared key throws (`duplicate key "post"`). Keys are not
 *   deep-merged.
 *
 * **Example** (Merging feature routers)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 *
 * const healthRouter = Router.make({ health: query({ success: Schema.Literal('ok') }) });
 * const postRouter = Router.make({ post: { count: query({ success: Schema.Number }) } });
 *
 * export const appRouter = Router.merge(healthRouter, postRouter); // tags: "health", "post.count"
 * ```
 *
 * @see {@link make}
 * @category combinators
 * @since 0.1.0
 */
const merge = <A extends Router.Shape, B extends Router.Shape>(
  a: Router<A>,
  b: Router<B>,
): Router<Router.Merge<A, B>> => {
  for (const key of Object.keys(b.record)) {
    if (Object.hasOwn(a.record, key)) {
      throw new Error(`Cannot merge routers: duplicate key "${key}"`);
    }
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- keys were checked disjoint above and both records are resolved, so the router's record is exactly `Merge<A, B>`
  return build({ ...a.record, ...b.record }) as unknown as Router<Router.Merge<A, B>>;
};

/**
 * Looks up a procedure by its path segments (`["post", "byId"]`).
 *
 * **When to use**
 *
 * Use in proxy-based code that collects path segments at runtime (e.g. `client.post.byId`).
 * Prefer {@link getRpc} when the tag is known statically.
 *
 * **Details**
 *
 * - Returns `Option.none()` for an empty path, a segment that is empty or contains `"."`, or a
 *   path that does not end at a procedure (e.g. `["post"]`).
 *
 * **Example** (Resolving a proxy path)
 *
 * ```ts
 * import { Option, Schema } from 'effect';
 * import { mutation, query, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   health: query({ success: Schema.Literal('ok') }),
 *   post: {
 *     byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }),
 *     create: mutation({ payload: { title: Schema.String }, success: Post }),
 *   },
 * });
 *
 * const info = Router.getByPath(appRouter, ['post', 'byId']);
 * if (Option.isSome(info)) console.log(info.value.tag, info.value.kind); // "post.byId query"
 * Option.isNone(Router.getByPath(appRouter, ['post'])); // true: a namespace, not a procedure
 * ```
 *
 * @see {@link getRpc}
 * @category getters
 * @since 0.1.0
 */
const getByPath = (
  router: Router.Any,
  path: ReadonlyArray<string>,
): Option.Option<ProcedureInfo> =>
  path.length === 0 || path.some((segment) => segment.length === 0 || segment.includes('.'))
    ? Option.none()
    : Option.fromUndefinedOr(router.procedures.get(path.join('.')));

/**
 * Returns the compiled rpc for a tag, precisely typed (`Rpc<"post.byId", ...>`).
 *
 * **When to use**
 *
 * Use with `Codecs` and anywhere a single procedure's schemas are needed (SSR dehydration, a
 * server action, a custom transport).
 *
 * **Gotchas**
 *
 * - Unknown tags are a type error; with an untyped tag it throws `Unknown procedure "<tag>"`.
 *
 * **Example** (Getting an rpc for its codecs)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { Codecs, mutation, query, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   health: query({ success: Schema.Literal('ok') }),
 *   post: {
 *     byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }),
 *     create: mutation({ payload: { title: Schema.String }, success: Post }),
 *   },
 * });
 *
 * const rpc = Router.getRpc(appRouter, 'post.byId'); // Rpc<"post.byId", ...>
 * const json = Codecs.encodeSuccessSync(rpc, new Post({ id: 1, title: 'Hello' }));
 * ```
 *
 * @see {@link getByPath}
 * @category getters
 * @since 0.1.0
 */
const getRpc = <R extends Router.Any, const Tag extends Router.Paths<R>>(
  router: R,
  tag: Tag,
): Rpc.ExtractTag<Router.Rpcs<R>, Tag> => {
  const info = router.procedures.get(tag);
  if (info === undefined) {
    throw new Error(`Unknown procedure "${String(tag)}"`);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `procedures` is keyed by tag, so this is the rpc compiled for `Tag`
  return info.rpc as unknown as Rpc.ExtractTag<Router.Rpcs<R>, Tag>;
};

const pathKey = (path: ReadonlyArray<string>): string => JSON.stringify(path);

const pathsCache = new WeakMap<Router.Any, ReadonlySet<string>>();

const declaredPaths = (router: Router.Any): ReadonlySet<string> => {
  let paths = pathsCache.get(router);
  if (paths === undefined) {
    const collected = new Set<string>();
    for (const info of router.procedures.values()) {
      for (let i = 1; i <= info.path.length; i++) collected.add(pathKey(info.path.slice(0, i)));
    }
    paths = collected;
    pathsCache.set(router, paths);
  }
  return paths;
};

/**
 * Returns `true` when `path` is declared by the router: a procedure or a namespace on the way to
 * one (the empty path is the root).
 *
 * **When to use**
 *
 * Use it in code that walks a router by path (proxies, adapters) to tell a namespace apart from an
 * unknown path, e.g. for an error message.
 *
 * **Example** (Telling namespaces from unknown paths)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 *
 * const appRouter = Router.make({ post: { byId: query({ success: Schema.String }) } });
 *
 * Router.isPath(appRouter, ['post']); // true: a namespace
 * Router.isPath(appRouter, ['post', 'byId']); // true: a procedure
 * Router.isPath(appRouter, ['user']); // false
 * ```
 *
 * @see {@link childPath}
 * @category getters
 * @since 0.1.0
 */
const isPath = (router: Router.Any, path: ReadonlyArray<string>): boolean =>
  path.length === 0 || declaredPaths(router).has(pathKey(path));

/**
 * Keys that `await`, `JSON.stringify`, test matchers, `util.inspect` and React dev tools probe on
 * any object. A router proxy that answered them with a callable node would look like a thenable,
 * a React element or a mock matcher.
 */
const introspectionKeys: ReadonlySet<string> = new Set([
  'then',
  'toJSON',
  'asymmetricMatch',
  'nodeType',
  '$$typeof',
  'constructor',
  'prototype',
  'inspect',
  'valueOf',
  'toString',
  'length',
  'name',
]);

/**
 * The key policy shared by every router proxy (client, caller, options proxy): resolves the
 * property `key` read on the proxy node at `path` to the child path, or `undefined` when the proxy
 * must not expose a child there.
 *
 * **When to use**
 *
 * Use it in the `get` trap of a proxy that mirrors a router, so that every proxy agrees on which
 * keys reach a procedure.
 *
 * **Details**
 *
 * - Symbols resolve to `undefined`.
 * - A declared path (see {@link isPath}) always resolves, even when its key is an introspection
 *   key such as `toJSON`, `toString` or `name`.
 * - Other introspection keys resolve to `undefined`, so that a proxy is not mistaken for a
 *   thenable, a React element or a test matcher.
 * - Any other key resolves to the child path, so that calling an unknown path can throw a useful
 *   error instead of `undefined is not a function`.
 *
 * **Gotchas**
 *
 * - Keys a proxy adds itself (`$effect`, `dispose`, `queryOptions`, ...) are not handled here:
 *   resolve them before calling `childPath`.
 *
 * **Example** (A minimal router proxy)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 *
 * const appRouter = Router.make({
 *   toJSON: query({ success: Schema.String }),
 *   post: { byId: query({ success: Schema.String }) },
 * });
 *
 * Router.childPath(appRouter, [], 'toJSON'); // ["toJSON"]: declared
 * Router.childPath(appRouter, ['post'], 'toJSON'); // undefined: introspection
 * Router.childPath(appRouter, ['post'], 'missing'); // ["post", "missing"]
 * ```
 *
 * @see {@link isPath}
 * @category getters
 * @since 0.1.0
 */
const childPath = (
  router: Router.Any,
  path: ReadonlyArray<string>,
  key: PropertyKey,
): ReadonlyArray<string> | undefined => {
  if (typeof key !== 'string') return undefined;
  const next = [...path, key];
  return introspectionKeys.has(key) && !isPath(router, next) ? undefined : next;
};

/**
 * Router constructors and helpers: `make`, `merge`, `from`, `fromService`, `getByPath`, `getRpc`,
 * `isPath`, `childPath`, `isRouter` and `isService`.
 *
 * **When to use**
 *
 * `Router.make` is the entry point for every effect-trpc API; the other helpers are for code
 * that inspects routers (adapters, client proxies, codecs).
 *
 * **Details**
 *
 * | API                                         | Description                                      |
 * | ------------------------------------------- | ------------------------------------------------ |
 * | `Router.make(record)`                       | Compile a nested record of procedures / routers. |
 * | `Router.merge(a, b)`                        | Merge two routers; overlapping keys throw.       |
 * | `Router.from(routerOrService)`              | Normalise a `Router.Input` to a router.          |
 * | `Router.fromService(AppRouter)`             | The router of a service (memoized per class).    |
 * | `Router.getByPath(router, ['post','byId'])` | `Option<ProcedureInfo>`.                         |
 * | `Router.getRpc(router, 'post.byId')`        | The compiled rpc, precisely typed.               |
 * | `Router.isPath(router, ['post'])`           | Is the path a namespace or procedure?            |
 * | `Router.childPath(router, path, key)`       | The key policy shared by router proxies.         |
 * | `Router.isRouter(u)`                        | Guard.                                           |
 * | `Router.isService(u)`                       | Guard for router services.                       |
 *
 * **Example** (Defining and inspecting a router)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { mutation, query, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   health: query({ success: Schema.Literal('ok') }),
 *   post: {
 *     byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }),
 *     create: mutation({ payload: { title: Schema.String }, success: Post }),
 *   },
 * });
 *
 * appRouter.procedures.get('post.byId')?.kind; // "query"
 * [...appRouter.group.requests.keys()]; // ["health", "post.byId", "post.create"]
 * const versionRouter = Router.make({ version: query({ success: Schema.String }) });
 * const merged = Router.merge(appRouter, versionRouter); // adds the "version" tag
 * ```
 *
 * @see {@link Router.make}
 * @category constructors
 * @since 0.1.0
 */
export const Router = {
  make,
  merge,
  from,
  fromService,
  getByPath,
  getRpc,
  isPath,
  childPath,
  isRouter,
  isService,
} as const;
