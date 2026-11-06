/**
 * Builds tRPC-style procedure definitions (`query`, `mutation`, `subscription`) from Effect
 * Schemas.
 *
 * A procedure definition is a plain description: payload/success/error schemas, a kind,
 * optional `RpcMiddleware` and optional annotations (tRPC's `meta`). `Router.make` compiles
 * definitions into `effect/rpc` rpcs whose tags are the dot-joined router paths;
 * `@effect-trpc/server` implements them and `@effect-trpc/client` calls them.
 *
 * @since 0.1.0
 */
import { Context, Predicate, Schema } from 'effect';
import { Rpc } from 'effect/rpc';
import type { RpcMiddleware, RpcSchema } from 'effect/rpc';
import type { ProcedureWithHandler } from './ProcedureBuilder.js';
import { ProcedureKind } from './ProcedureKind.js';

const TypeId = '~@effect-trpc/core/ProcedureDef' as const;

/**
 * What a builder accepts as `payload`: a schema, or `Schema.Struct` fields.
 *
 * **Details**
 *
 * - Struct fields (`{ id: Schema.Number }`) are wrapped in `Schema.Struct`; any schema
 *   (`Schema.String`, a `Schema.Class`, a union) is used as-is.
 *
 * **Example** (Two equivalent payloads)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { query } from '@effect-trpc/core';
 *
 * const a = query({ payload: { id: Schema.Number } });
 * const b = query({ payload: Schema.Struct({ id: Schema.Number }) });
 * ```
 *
 * @see {@link NormalizePayload}
 * @category type-level
 * @since 0.1.0
 */
export type PayloadInput = Schema.Top | Schema.Struct.Fields;

/**
 * Normalizes a {@link PayloadInput} to a schema (struct fields become a `Schema.Struct`).
 *
 * **Example** (Normalizing struct fields)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import type { NormalizePayload } from '@effect-trpc/core';
 *
 * type Payload = NormalizePayload<{ readonly id: typeof Schema.Number }>;
 * // Schema.Struct<{ readonly id: typeof Schema.Number }>
 * ```
 *
 * @see {@link PayloadInput}
 * @category type-level
 * @since 0.1.0
 */
export type NormalizePayload<P> = P extends Schema.Struct.Fields ? Schema.Struct<P> : P;

/**
 * A procedure definition: the schemas and kind of one tRPC-style procedure, without a tag.
 *
 * **When to use**
 *
 * Create one with {@link query}, {@link mutation} or {@link subscription} and place it in a
 * `Router.make` record. Use the type to constrain generic helpers; use {@link inferInput},
 * {@link inferOutput} and {@link inferError} to read its decoded types.
 *
 * **Details**
 *
 * - The tag (`"post.byId"`) is assigned by `Router.make` from the procedure's path in the router
 *   record, so the same definition can live under several paths.
 * - Definitions are frozen; `.middleware(M)` and `.annotate(key, value)` return a new definition.
 * - `.annotate(key, value)` is tRPC's `.meta()`: runtime metadata on the compiled rpc
 *   (`rpc.annotations`) that middleware reads with `Context.get(rpc.annotations, key)`. It does not
 *   change the definition's type; annotating the same key again replaces the value. The
 *   {@link ProcedureKind} annotation is applied last: annotating that key does not change the kind.
 * - `Payload` – input schema (`Schema.Void` when the procedure takes no input)
 * - `Success` – output schema; for subscriptions this is the schema of each streamed element
 * - `Error` – typed failure schema (`Schema.Never` when the procedure cannot fail)
 * - `Middleware` / `Requires` – `effect/rpc` middleware applied to the compiled rpc
 *
 * **Example** (A definition with middleware)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { RpcMiddleware } from 'effect/rpc';
 * import { mutation } from '@effect-trpc/core';
 * import type { inferError } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}
 * class Auth extends RpcMiddleware.Service<Auth>()('Auth', { error: Unauthorized }) {}
 *
 * const create = mutation({ payload: { title: Schema.String }, success: Post }).middleware(Auth);
 * type CreateError = inferError<typeof create>; // Unauthorized (from the middleware)
 * ```
 *
 * **Example** (Meta read by middleware)
 *
 * ```ts
 * import { Context, Effect, Layer, Schema } from 'effect';
 * import { RpcMiddleware } from 'effect/rpc';
 * import { query, Router } from '@effect-trpc/core';
 *
 * class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {}) {}
 * class RequireRoles extends RpcMiddleware.Service<RequireRoles>()('RequireRoles', {
 *   error: Forbidden,
 * }) {}
 * // A `Context.Reference` gives the default for procedures that do not set it.
 * const Roles = Context.Reference<ReadonlyArray<string>>('Roles', { defaultValue: () => [] });
 *
 * export const appRouter = Router.make({
 *   health: query({ success: Schema.Literal('ok') }),
 *   stats: query({ success: Schema.Number }).annotate(Roles, ['admin']),
 * }).middleware(RequireRoles);
 *
 * export const RequireRolesLive = Layer.succeed(RequireRoles)(
 *   RequireRoles.of((effect, { rpc, headers }) => {
 *     const granted = headers['x-roles']?.split(',') ?? [];
 *     return Context.get(rpc.annotations, Roles).every((role) => granted.includes(role))
 *       ? effect
 *       : Effect.fail(new Forbidden());
 *   }),
 * );
 * ```
 *
 * @see {@link query}
 * @see {@link mutation}
 * @see {@link subscription}
 * @category models
 * @since 0.1.0
 */
export interface ProcedureDef<
  Kind extends ProcedureKind.Value,
  Payload extends Schema.Top = Schema.Void,
  Success extends Schema.Top = Schema.Void,
  Error extends Schema.Top = Schema.Never,
  Middleware extends RpcMiddleware.AnyService = never,
  Requires = never,
> {
  readonly [TypeId]: typeof TypeId;
  /** `"query"`, `"mutation"` or `"subscription"`. */
  readonly kind: Kind;
  /** The input schema (`Schema.Void` when no `payload` was given). */
  readonly payloadSchema: Payload;
  /** The output schema; for subscriptions, the schema of each element. */
  readonly successSchema: Success;
  /** The typed failure schema (`Schema.Never` when no `error` was given). */
  readonly errorSchema: Error;
  /** Middleware in application order. */
  readonly middlewares: ReadonlyArray<RpcMiddleware.AnyService>;
  /**
   * Type-level only (always `undefined` at runtime). Use `inferInput`, `inferOutput`,
   * `inferError` and `inferKind` instead of reading it directly.
   */
  readonly '~types'?: ProcedureDef.Types<Kind, Payload, Success, Error, Middleware>;
  /** Returns a new definition with `middleware` added (applied after existing middleware). */
  middleware<M extends RpcMiddleware.AnyService>(
    middleware: M,
  ): ProcedureDef<
    Kind,
    Payload,
    Success,
    Error,
    Middleware | M,
    RpcMiddleware.ApplyServices<M['Identifier'], Requires>
  >;
  /**
   * Returns a new definition annotated with `key` = `value` (tRPC's `.meta()`); the compiled rpc
   * carries it in `rpc.annotations`. The type is unchanged; a later value of the same key wins.
   */
  annotate<I, S>(
    key: Context.Key<I, S>,
    value: NoInfer<S>,
  ): ProcedureDef<Kind, Payload, Success, Error, Middleware, Requires>;
  /** Compiles the definition to an `effect/rpc` `Rpc` with the given tag. */
  toRpc<const Tag extends string>(
    tag: Tag,
  ): RpcOf<Kind, Payload, Success, Error, Middleware, Requires, Tag>;
}

/**
 * Types related to {@link ProcedureDef}.
 *
 * @category models
 * @since 0.1.0
 */
export declare namespace ProcedureDef {
  /**
   * Any procedure definition. Deliberately minimal: it only brands the value, so that inline
   * definitions inside `Router.make({...})` infer their own schemas instead of `Schema.Top`.
   *
   * @since 0.1.0
   */
  export interface Any {
    readonly [TypeId]: typeof TypeId;
    readonly kind: ProcedureKind.Value;
  }

  /**
   * The decoded types carried by a definition (read them with `inferInput` & co.).
   *
   * @since 0.1.0
   */
  export interface Types<
    Kind extends ProcedureKind.Value,
    Payload extends Schema.Top,
    Success extends Schema.Top,
    Error extends Schema.Top,
    Middleware extends RpcMiddleware.AnyService,
  > {
    readonly kind: Kind;
    readonly input: Payload['Type'];
    /** For subscriptions: the type of each streamed element. */
    readonly output: Success['Type'];
    /** Procedure errors plus the errors declared by its middleware. */
    readonly error: Error['Type'] | Middleware['error']['Type'];
  }

  /**
   * Adds middleware `M` to a definition type (the type of `def.middleware(M)`). A procedure built
   * with `Procedure` stays a `ProcedureWithHandler` with the same handler requirements.
   *
   * @since 0.1.0
   */
  export type AddMiddleware<D, M extends RpcMiddleware.AnyService> =
    D extends ProcedureWithHandler<
      infer K,
      infer P,
      infer S,
      infer E,
      infer Mw,
      infer Rq,
      infer HandlerR
    >
      ? ProcedureWithHandler<
          K,
          P,
          S,
          E,
          Mw | M,
          RpcMiddleware.ApplyServices<M['Identifier'], Rq>,
          HandlerR
        >
      : D extends ProcedureDef<infer K, infer P, infer S, infer E, infer Mw, infer Rq>
        ? ProcedureDef<K, P, S, E, Mw | M, RpcMiddleware.ApplyServices<M['Identifier'], Rq>>
        : never;

  /**
   * The `Rpc` a definition compiles to under `Tag`. Subscriptions become streaming rpcs
   * (`RpcSchema.Stream<Success, Error>` success and a `Schema.Never` rpc error).
   *
   * @since 0.1.0
   */
  export type ToRpc<D, Tag extends string> = D extends unknown
    ? DefOf<D> extends ProcedureDef<infer K, infer P, infer S, infer E, infer Mw, infer Rq>
      ? RpcOf<K, P, S, E, Mw, Rq, Tag>
      : never
    : never;
}

/** The rpc of a definition (distributes over `Kind`). */
type RpcOf<
  Kind extends ProcedureKind.Value,
  Payload extends Schema.Top,
  Success extends Schema.Top,
  Error extends Schema.Top,
  Middleware extends RpcMiddleware.AnyService,
  Requires,
  Tag extends string,
> = Kind extends 'subscription'
  ? Rpc.Rpc<Tag, Payload, RpcSchema.Stream<Success, Error>, Schema.Never, Middleware, Requires>
  : Rpc.Rpc<Tag, Payload, Success, Error, Middleware, Requires>;

/**
 * `D` as a plain `ProcedureDef<...>` reference, so that `infer` reads its type arguments
 * directly. Inferring `ProcedureDef<infer ...>` structurally from a `ProcedureWithHandler`
 * subscription would also pick `Success` candidates from the streaming branch of `toRpc`.
 */
type DefOf<D> =
  D extends ProcedureWithHandler<
    infer K,
    infer P,
    infer S,
    infer E,
    infer Mw,
    infer Rq,
    infer _HandlerR
  >
    ? ProcedureDef<K, P, S, E, Mw, Rq>
    : D;

/**
 * The decoded input (payload) type of a procedure definition. `void` when it takes no input.
 *
 * **Example** (Reading a procedure's input)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { RpcMiddleware } from 'effect/rpc';
 * import { query, subscription } from '@effect-trpc/core';
 * import type { inferError, inferInput, inferKind, inferOutput } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 * class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}
 * class Auth extends RpcMiddleware.Service<Auth>()('Auth', { error: Unauthorized }) {}
 *
 * const byId = query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound });
 * const onPost = subscription({ success: Post }).middleware(Auth);
 *
 * type ByIdInput = inferInput<typeof byId>; // { readonly id: number }
 * type OnPostInput = inferInput<typeof onPost>; // void
 * ```
 *
 * @see {@link inferRouterInputs}
 * @category type-level
 * @since 0.1.0
 */
export type inferInput<D extends ProcedureDef.Any> = TypesOf<D>['input'];
/**
 * The decoded output type of a procedure definition (the element type for subscriptions).
 *
 * **Example** (Reading a procedure's output)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { RpcMiddleware } from 'effect/rpc';
 * import { query, subscription } from '@effect-trpc/core';
 * import type { inferError, inferInput, inferKind, inferOutput } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 * class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}
 * class Auth extends RpcMiddleware.Service<Auth>()('Auth', { error: Unauthorized }) {}
 *
 * const byId = query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound });
 * const onPost = subscription({ success: Post }).middleware(Auth);
 *
 * type ByIdOutput = inferOutput<typeof byId>; // Post
 * type OnPostOutput = inferOutput<typeof onPost>; // Post (one element)
 * ```
 *
 * @see {@link inferRouterOutputs}
 * @category type-level
 * @since 0.1.0
 */
export type inferOutput<D extends ProcedureDef.Any> = TypesOf<D>['output'];
/**
 * The typed error of a procedure definition, including errors declared by its middleware.
 *
 * **Details**
 *
 * - Excludes the infrastructure errors; a client call fails with `ClientError<inferError<D>>`.
 *
 * **Example** (Reading a procedure's typed error)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { RpcMiddleware } from 'effect/rpc';
 * import { query, subscription } from '@effect-trpc/core';
 * import type { inferError, inferInput, inferKind, inferOutput } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 * class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}
 * class Auth extends RpcMiddleware.Service<Auth>()('Auth', { error: Unauthorized }) {}
 *
 * const byId = query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound });
 * const onPost = subscription({ success: Post }).middleware(Auth);
 *
 * type ByIdError = inferError<typeof byId>; // PostNotFound
 * type OnPostError = inferError<typeof onPost>; // Unauthorized
 * ```
 *
 * @see {@link inferRouterErrors}
 * @category type-level
 * @since 0.1.0
 */
export type inferError<D extends ProcedureDef.Any> = TypesOf<D>['error'];
/**
 * The kind (`"query" | "mutation" | "subscription"`) of a procedure definition.
 *
 * **Example** (Reading a procedure's kind)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { RpcMiddleware } from 'effect/rpc';
 * import { query, subscription } from '@effect-trpc/core';
 * import type { inferError, inferInput, inferKind, inferOutput } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 * class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}
 * class Auth extends RpcMiddleware.Service<Auth>()('Auth', { error: Unauthorized }) {}
 *
 * const byId = query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound });
 * const onPost = subscription({ success: Post }).middleware(Auth);
 *
 * type ByIdKind = inferKind<typeof byId>; // "query"
 * type OnPostKind = inferKind<typeof onPost>; // "subscription"
 * ```
 *
 * @see {@link ProcedureKind}
 * @category type-level
 * @since 0.1.0
 */
export type inferKind<D extends ProcedureDef.Any> = D['kind'];

type TypesOf<D> = D extends unknown
  ? DefOf<D> extends ProcedureDef<infer K, infer P, infer S, infer E, infer M, infer _Rq>
    ? ProcedureDef.Types<K, P, S, E, M>
    : never
  : never;

/**
 * Returns `true` when `u` is a procedure definition created by `query`, `mutation` or
 * `subscription`.
 *
 * **When to use**
 *
 * Use when walking a router record by hand (e.g. building a custom client proxy or docs
 * generator) to tell procedures apart from nested records and routers.
 *
 * **Example** (Listing the procedures of a flat record)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { isProcedureDef, query } from '@effect-trpc/core';
 *
 * const record: Record<string, unknown> = {
 *   health: query({ success: Schema.Literal('ok') }),
 *   post: {},
 * };
 * const procedures = Object.keys(record).filter((key) => isProcedureDef(record[key])); // ["health"]
 * ```
 *
 * @see {@link ProcedureDef}
 * @category guards
 * @since 0.1.0
 */
export const isProcedureDef = (u: unknown): u is ProcedureDef.Any =>
  Predicate.hasProperty(u, TypeId) && u[TypeId] === TypeId;

/** A procedure implementation, erased (its precise type lives on `ProcedureWithHandler`). */
type AnyHandler = (...args: ReadonlyArray<never>) => unknown;

interface DefState {
  readonly kind: ProcedureKind.Value;
  readonly payloadSchema: Schema.Top;
  readonly successSchema: Schema.Top;
  readonly errorSchema: Schema.Top;
  readonly middlewares: ReadonlyArray<RpcMiddleware.AnyService>;
  /** User annotations, applied to the compiled rpc before `ProcedureKind` (the kind wins). */
  readonly annotations: Context.Context<never>;
  /** Only procedures built with `Procedure` have one; plain definitions omit the key. */
  readonly handler?: AnyHandler;
}

type AnyRpc = Rpc.Rpc<string, Schema.Top, Schema.Top, Schema.Top, any, any>;

class ProcedureDefImpl implements DefState {
  readonly [TypeId] = TypeId;
  readonly kind: ProcedureKind.Value;
  readonly payloadSchema: Schema.Top;
  readonly successSchema: Schema.Top;
  readonly errorSchema: Schema.Top;
  readonly middlewares: ReadonlyArray<RpcMiddleware.AnyService>;
  readonly annotations: Context.Context<never>;
  // `declare`: no own `handler` key is emitted for plain definitions.
  declare readonly handler?: AnyHandler;

  constructor(state: DefState) {
    this.kind = state.kind;
    this.payloadSchema = state.payloadSchema;
    this.successSchema = state.successSchema;
    this.errorSchema = state.errorSchema;
    this.middlewares = Object.freeze([...state.middlewares]);
    this.annotations = state.annotations;
    if (state.handler !== undefined) this.handler = state.handler;
    Object.freeze(this);
  }

  middleware(middleware: RpcMiddleware.AnyService): ProcedureDefImpl {
    return this.copy({ middlewares: [...this.middlewares, middleware] });
  }

  annotate<I, S>(key: Context.Key<I, S>, value: S): ProcedureDefImpl {
    return this.copy({ annotations: Context.add(this.annotations, key, value) });
  }

  // The handler travels with the definition, so a step never drops an implementation.
  private copy(changes: Partial<Pick<DefState, 'middlewares' | 'annotations'>>): ProcedureDefImpl {
    const next: DefState = {
      kind: this.kind,
      payloadSchema: this.payloadSchema,
      successSchema: this.successSchema,
      errorSchema: this.errorSchema,
      middlewares: this.middlewares,
      annotations: this.annotations,
      ...changes,
    };
    return new ProcedureDefImpl(
      this.handler === undefined ? next : { ...next, handler: this.handler },
    );
  }

  toRpc(tag: string): AnyRpc {
    let rpc: AnyRpc = Rpc.make(tag, {
      payload: this.payloadSchema,
      success: this.successSchema,
      error: this.errorSchema,
      stream: this.kind === 'subscription',
    });
    for (const middleware of this.middlewares) {
      rpc = rpc.middleware(middleware);
    }
    return rpc.annotateMerge(this.annotations).annotate(ProcedureKind, this.kind);
  }
}

const normalizePayload = (payload: PayloadInput | undefined): Schema.Top =>
  payload === undefined ? Schema.Void : Schema.isSchema(payload) ? payload : Schema.Struct(payload);

/** @internal Compiles any definition (used by `Router`). */
export const compileDef = (def: ProcedureDef.Any, tag: string): Rpc.AnyWithProps =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every `ProcedureDef` is created by this module as a `ProcedureDefImpl`
  (def as ProcedureDefImpl).toRpc(tag);

/** @internal Adds middleware to any definition (used by `Router`). */
export const addDefMiddleware = (
  def: ProcedureDef.Any,
  middleware: RpcMiddleware.AnyService,
): ProcedureDef.Any =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every `ProcedureDef` is created by this module as a `ProcedureDefImpl`
  (def as ProcedureDefImpl).middleware(middleware);

/**
 * @internal Creates a definition (used by the builders below and by `Procedure`). Returns `any`:
 * callers assign the precise `ProcedureDef<...>` / `ProcedureWithHandler<...>` type.
 */
export const define = (
  kind: ProcedureKind.Value,
  options: {
    readonly payload?: PayloadInput;
    readonly success?: Schema.Top;
    readonly error?: Schema.Top;
    readonly annotations?: Context.Context<never>;
    readonly handler?: AnyHandler;
  },
): any => {
  const state: DefState = {
    kind,
    payloadSchema: normalizePayload(options.payload),
    successSchema: options.success ?? Schema.Void,
    errorSchema: options.error ?? Schema.Never,
    middlewares: [],
    annotations: options.annotations ?? Context.empty(),
  };
  return new ProcedureDefImpl(
    options.handler === undefined ? state : { ...state, handler: options.handler },
  );
};

/**
 * Defines a query procedure (a read; maps to tRPC's `.query()`).
 *
 * **When to use**
 *
 * Use for side-effect-free reads. Clients cache queries (`queryOptions` in the TanStack Query
 * bridge); use {@link mutation} for writes and {@link subscription} for server streams.
 *
 * **Details**
 *
 * - `payload` may be a schema or `Schema.Struct` fields; omitted → `Schema.Void` (input `void`).
 * - `success` omitted → `Schema.Void`; `error` omitted → `Schema.Never`.
 * - Errors must be `Schema.TaggedError` classes (or a `Schema.Union` of them) so clients receive
 *   real instances discriminated by `_tag`.
 * - Returns a frozen {@link ProcedureDef}; `.middleware(M)` adds `effect/rpc` middleware and
 *   `.annotate(key, value)` adds metadata for it (tRPC's `.meta()`).
 *
 * **Example** (A query with a typed error)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({
 *   id: Schema.Number,
 *   title: Schema.String,
 *   createdAt: Schema.Date,
 * }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 * class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', { reason: Schema.String }) {}
 *
 * export const appRouter = Router.make({
 *   health: query({ success: Schema.Literal('ok') }), // no payload: input is `void`
 *   post: {
 *     byId: query({
 *       payload: { id: Schema.Number },
 *       success: Post,
 *       error: Schema.Union([PostNotFound, Forbidden]),
 *     }),
 *   },
 * });
 * ```
 *
 * @see {@link mutation}
 * @see {@link subscription}
 * @category constructors
 * @since 0.1.0
 */
export const query = <
  P extends PayloadInput = Schema.Void,
  S extends Schema.Top = Schema.Void,
  E extends Schema.Top = Schema.Never,
>(
  options: {
    readonly payload?: P;
    readonly success?: S;
    readonly error?: E;
  } = {},
): ProcedureDef<'query', NormalizePayload<P>, S, E> => define('query', options);

/**
 * Defines a mutation procedure (a write; maps to tRPC's `.mutation()`).
 *
 * **When to use**
 *
 * Use for calls with side effects (create, update, delete). Prefer {@link query} for reads, so
 * clients can cache them.
 *
 * **Details**
 *
 * - Same options and defaults as {@link query}; only the kind (`"mutation"`) differs, which
 *   clients and the TanStack Query bridge use to choose `mutationOptions`.
 *
 * **Example** (A guarded mutation)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { RpcMiddleware } from 'effect/rpc';
 * import { mutation, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', { reason: Schema.String }) {}
 * class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}
 * class Auth extends RpcMiddleware.Service<Auth>()('Auth', { error: Unauthorized }) {}
 *
 * export const appRouter = Router.make({
 *   post: {
 *     create: mutation({
 *       payload: { title: Schema.String },
 *       success: Post,
 *       error: Forbidden,
 *     }).middleware(Auth), // typed error is now Forbidden | Unauthorized
 *   },
 * });
 * ```
 *
 * @see {@link query}
 * @category constructors
 * @since 0.1.0
 */
export const mutation = <
  P extends PayloadInput = Schema.Void,
  S extends Schema.Top = Schema.Void,
  E extends Schema.Top = Schema.Never,
>(
  options: {
    readonly payload?: P;
    readonly success?: S;
    readonly error?: E;
  } = {},
): ProcedureDef<'mutation', NormalizePayload<P>, S, E> => define('mutation', options);

/**
 * Defines a subscription procedure: a server stream of `success` elements that may fail with
 * `error`.
 *
 * **When to use**
 *
 * Use when the server pushes several values over time (live updates, progress, a feed). Handlers
 * return a `Stream`; Promise clients expose an `AsyncIterable`, Effect clients a `Stream`.
 *
 * **Details**
 *
 * - Compiles to `Rpc.make(tag, { stream: true, ... })`: the rpc's success is
 *   `RpcSchema.Stream<Success, Error>` and its rpc-level error is `Schema.Never`.
 * - `success` is required (the element schema); `inferOutput` is the element type.
 *
 * **Gotchas**
 *
 * - Unlike `query()` / `mutation()`, `subscription()` has no zero-argument form: `success` is
 *   required.
 *
 * **Example** (A stream of posts)
 *
 * ```ts
 * import { Schema, Stream } from 'effect';
 * import { Router, subscription } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 *
 * const appRouter = Router.make({
 *   post: { onCreated: subscription({ payload: { since: Schema.Number }, success: Post }) },
 * });
 *
 * // effect/rpc handlers return a Stream of elements
 * const HandlersLive = appRouter.group.toLayer({
 *   'post.onCreated': ({ since }) =>
 *     Stream.fromIterable([since, since + 1]).pipe(
 *       Stream.map((id) => new Post({ id, title: `Post ${id}` })),
 *     ),
 * });
 * ```
 *
 * @see {@link query}
 * @category constructors
 * @since 0.1.0
 */
export const subscription = <
  P extends PayloadInput = Schema.Void,
  S extends Schema.Top = Schema.Void,
  E extends Schema.Top = Schema.Never,
>(options: {
  readonly payload?: P;
  readonly success: S;
  readonly error?: E;
}): ProcedureDef<'subscription', NormalizePayload<P>, S, E> => define('subscription', options);
