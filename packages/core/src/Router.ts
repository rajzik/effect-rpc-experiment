/**
 * Compiles nested records of procedure definitions into a tRPC-style `Router`.
 *
 * A router is a thin, frozen wrapper around an `effect/rpc` `RpcGroup` whose tags are the
 * dot-joined record paths (`"post.byId"`). `@effect-trpc/server` implements `router.group`,
 * `@effect-trpc/client` builds a nested proxy from `router.procedures`, and the type helpers here
 * (`inferRouterInputs`, `Router.Paths`, ...) give tRPC-style inference over the whole tree.
 *
 * @since 0.1.0
 */
import { Option, Predicate } from 'effect';
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
   * A router record: procedure definitions, routers or nested records, keyed by path segment.
   *
   * @since 0.1.0
   */
  export type Shape = {
    readonly [key: string]: ProcedureDef.Any | Any | Shape;
  };

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
   * The record of a router type.
   *
   * @since 0.1.0
   */
  export type Record<R> = R extends Router<infer Rec> ? Rec : never;

  /**
   * The union of `Rpc`s a router (or router record) compiles to, with literal tags such as
   * `"post.byId"`. Use with `Rpc.ExtractTag`, `RpcClient.RpcClient` and other `effect/rpc` types.
   *
   * @since 0.1.0
   */
  export type Rpcs<R> = R extends Any
    ? RpcsOf<R['record'], ''>
    : R extends Shape
      ? RpcsOf<R, ''>
      : never;

  /**
   * The union of procedure tags (dot-joined paths) of a router or router record, e.g.
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

type RecordOf<R> = R extends Router<infer Rec> ? Rec : R;

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
        `Invalid router entry at "${path.join('.')}": expected a procedure (query, mutation, subscription), a router or a nested record`,
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
    const value = record[key];
    if (isProcedureDef(value)) {
      out[key] = addDefMiddleware(value, middleware);
    } else if (isRouter(value)) {
      out[key] = make(applyMiddleware(value.record, middleware));
    } else if (value !== undefined) {
      out[key] = applyMiddleware(value, middleware);
    }
  }
  return out;
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
 *
 * **Gotchas**
 *
 * - Throws if a key is empty, contains `"."` (nest records instead), is a reserved word (`then`,
 *   `call`, `apply` — they would break proxy-based clients) or if a value is not a procedure,
 *   router or plain record.
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
const make = <const Rec extends Router.Shape>(record: Rec): Router<Rec> => {
  const procedures = new Map<string, ProcedureInfo>();
  collect(record, [], procedures);
  const group = RpcGroup.make(...Array.from(procedures.values(), (info) => info.rpc));
  const router: Router<Rec> = {
    [TypeId]: TypeId,
    record,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the group is compiled from `record`, so its rpcs are `Router.Rpcs<Rec>`
    group: group as unknown as RpcGroup.RpcGroup<Router.Rpcs<Rec>>,
    procedures,
    middleware: <M extends RpcMiddleware.AnyService>(middleware: M) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `applyMiddleware` adds `M` to every definition, which is what `WithMiddleware` describes
      make(applyMiddleware(record, middleware)) as unknown as Router<Router.WithMiddleware<Rec, M>>,
  };
  return Object.freeze(router);
};

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
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- keys were checked disjoint above, so the spread is exactly `Merge<A, B>`
  return make({ ...a.record, ...b.record } as Router.Merge<A, B> & Router.Shape);
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
 * Router constructors and helpers: `make`, `merge`, `getByPath`, `getRpc`, `isPath`, `childPath`
 * and `isRouter`.
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
 * | `Router.getByPath(router, ['post','byId'])` | `Option<ProcedureInfo>`.                         |
 * | `Router.getRpc(router, 'post.byId')`        | The compiled rpc, precisely typed.               |
 * | `Router.isPath(router, ['post'])`           | Is the path a namespace or procedure?            |
 * | `Router.childPath(router, path, key)`       | The key policy shared by router proxies.         |
 * | `Router.isRouter(u)`                        | Guard.                                           |
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
  getByPath,
  getRpc,
  isPath,
  childPath,
  isRouter,
} as const;
