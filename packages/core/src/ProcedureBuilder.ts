/**
 * Builds tRPC-style procedures that carry their schemas and their implementation together
 * (`Procedure.input(...).output(...).query(handler)`).
 *
 * A builder procedure is an ordinary `ProcedureDef` — `Router.make`, the client proxies, codecs
 * and every inference helper treat it exactly like the equivalent `query({...})` — plus a
 * `handler` field holding the implementation. `@effect-trpc/server` serves those handlers
 * (`Handlers.fromService`, `Handlers.fromProcedures`), so a router written with the builder is
 * written once.
 *
 * @since 0.1.0
 */
import { Predicate, Schema } from 'effect';
import type { Effect, Stream } from 'effect';
import type { Headers } from 'effect/http';
import type { Rpc, RpcMessage, RpcMiddleware } from 'effect/rpc';
import { addDefMiddleware, define, isProcedureDef } from './Procedure.js';
import type { NormalizePayload, PayloadInput, ProcedureDef } from './Procedure.js';
import type { ProcedureKind } from './ProcedureKind.js';

/**
 * A procedure built with {@link Procedure}: a {@link ProcedureDef} plus the `handler` that
 * implements it.
 *
 * **When to use**
 *
 * Use the type to constrain helpers that need an implementation (e.g. a server that serves the
 * procedures' own handlers); read the handler's services with
 * {@link Procedure.HandlerRequirements}. Create values with the {@link Procedure} builder.
 *
 * **Details**
 *
 * - It extends `ProcedureDef<Kind, Payload, Success, Error, Middleware, Requires>`, so it
 *   compiles to the same rpc (tag, schemas, `ProcedureKind` annotation) as the equivalent
 *   `query` / `mutation` / `subscription` definition, and `inferInput` & co. give the same types.
 * - `HandlerR` is the handler's requirements (the services it reads with `yield*`), as written:
 *   services provided by middleware are still listed; the server removes them.
 * - `.middleware(M)` and `router.middleware(M)` keep the handler (value and type).
 *
 * **Example** (Reading the parts of a builder procedure)
 *
 * ```ts
 * import { Context, Effect, Schema } from 'effect';
 * import { Procedure } from '@effect-trpc/core';
 * import type { inferInput } from '@effect-trpc/core';
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
 * const byId = Procedure.input({ id: Schema.Finite })
 *   .output(Post)
 *   .error(PostNotFound)
 *   .query(
 *     Effect.fn(function* ({ id }) {
 *       const db = yield* Database;
 *       return yield* db.findPost(id);
 *     }),
 *   );
 *
 * type Input = inferInput<typeof byId>; // { readonly id: number }
 * type Services = Procedure.HandlerRequirements<typeof byId>; // Database
 * ```
 *
 * @see {@link Procedure}
 * @category models
 * @since 0.1.0
 */
export interface ProcedureWithHandler<
  Kind extends ProcedureKind.Value,
  Payload extends Schema.Top,
  Success extends Schema.Top,
  Error extends Schema.Top,
  Middleware extends RpcMiddleware.AnyService,
  Requires,
  HandlerR,
> extends ProcedureDef<Kind, Payload, Success, Error, Middleware, Requires> {
  /** The implementation: an `Effect` for queries and mutations, a `Stream` for subscriptions. */
  readonly handler: Procedure.Handler<Kind, Payload, Success, Error, Middleware, HandlerR>;
  /** Returns a new procedure with `middleware` added; the handler is kept. */
  middleware<M extends RpcMiddleware.AnyService>(
    middleware: M,
  ): ProcedureWithHandler<
    Kind,
    Payload,
    Success,
    Error,
    Middleware | M,
    RpcMiddleware.ApplyServices<M['Identifier'], Requires>,
    HandlerR
  >;
}

/**
 * Types related to {@link ProcedureWithHandler}.
 *
 * @category models
 * @since 0.1.0
 */
export declare namespace ProcedureWithHandler {
  /**
   * Any procedure with a handler (narrow to it with `Procedure.hasHandler`). The handler's
   * payload is `never` here: cast it at the call site that knows the procedure.
   *
   * @since 0.1.0
   */
  export interface Any extends ProcedureDef.Any {
    readonly handler: (
      payload: never,
      ctx: Procedure.HandlerContext,
    ) => Effect.Effect<unknown, unknown, unknown> | Stream.Stream<unknown, unknown, unknown>;
  }
}

/**
 * Types of the {@link Procedure} builder: the builder itself, the handler signatures and the
 * handler's requirements.
 *
 * @category type-level
 * @since 0.1.0
 */
export declare namespace Procedure {
  /**
   * What every handler receives as its second argument: the `effect/rpc` handler context, the
   * same values `Handlers.make` handlers receive. `headers` are the HTTP request headers merged
   * with the rpc message headers; `rpc` is the compiled rpc of the procedure being called, typed
   * as `Rpc.Any` like effect's own `Rpc.Handler` (so every concrete rpc, middleware included, is
   * accepted); read its kind with `Context.get(ctx.rpc.annotations, ProcedureKind)`.
   *
   * @since 0.1.0
   */
  export interface HandlerContext {
    readonly client: Rpc.ServerClient;
    readonly requestId: RpcMessage.RequestId;
    readonly headers: Headers.Headers;
    readonly rpc: Rpc.Any;
  }

  /**
   * The failures a handler may produce: the procedure's `error` plus the errors declared by its
   * middleware.
   *
   * @since 0.1.0
   */
  export type HandlerError<Error extends Schema.Top, Middleware extends RpcMiddleware.AnyService> =
    | Error['Type']
    | Middleware['error']['Type'];

  /**
   * The handler of a query or mutation: decoded payload and context in, an `Effect` of the
   * decoded success out.
   *
   * @since 0.1.0
   */
  export type EffectHandler<
    Payload extends Schema.Top,
    Success extends Schema.Top,
    Error extends Schema.Top,
    Middleware extends RpcMiddleware.AnyService,
    R,
  > = (
    payload: Payload['Type'],
    ctx: HandlerContext,
  ) => Effect.Effect<Success['Type'], HandlerError<Error, Middleware>, R>;

  /**
   * The handler of a subscription: decoded payload and context in, a `Stream` of decoded
   * elements out.
   *
   * @since 0.1.0
   */
  export type StreamHandler<
    Payload extends Schema.Top,
    Success extends Schema.Top,
    Error extends Schema.Top,
    Middleware extends RpcMiddleware.AnyService,
    R,
  > = (
    payload: Payload['Type'],
    ctx: HandlerContext,
  ) => Stream.Stream<Success['Type'], HandlerError<Error, Middleware>, R>;

  /**
   * The handler type of a procedure of kind `Kind` ({@link StreamHandler} for subscriptions,
   * {@link EffectHandler} otherwise).
   *
   * @since 0.1.0
   */
  export type Handler<
    Kind extends ProcedureKind.Value,
    Payload extends Schema.Top,
    Success extends Schema.Top,
    Error extends Schema.Top,
    Middleware extends RpcMiddleware.AnyService,
    R,
  > = Kind extends 'subscription'
    ? StreamHandler<Payload, Success, Error, Middleware, R>
    : EffectHandler<Payload, Success, Error, Middleware, R>;

  /**
   * The services a procedure's handler requires (`never` for a definition without a handler).
   *
   * @since 0.1.0
   */
  export type HandlerRequirements<P> =
    P extends ProcedureWithHandler<
      infer _Kind,
      infer _Payload,
      infer _Success,
      infer _Error,
      infer _Middleware,
      infer _Requires,
      infer R
    >
      ? R
      : never;

  /**
   * An immutable procedure builder. Each step returns a new builder; a terminal (`query`,
   * `mutation`, `subscription`) takes the handler and returns a {@link ProcedureWithHandler}.
   *
   * @since 0.1.0
   */
  export interface Builder<
    Payload extends Schema.Top,
    Success extends Schema.Top,
    Error extends Schema.Top,
    Middleware extends RpcMiddleware.AnyService,
    Requires,
  > {
    /** Sets the input: a schema or `Schema.Struct` fields (replaces an earlier `input`). */
    readonly input: <P extends PayloadInput>(
      input: P,
    ) => Builder<NormalizePayload<P>, Success, Error, Middleware, Requires>;
    /** Sets the success schema (for subscriptions: each element; replaces an earlier `output`). */
    readonly output: <S extends Schema.Top>(
      schema: S,
    ) => Builder<Payload, S, Error, Middleware, Requires>;
    /** Sets the typed error schema (replaces an earlier `error`; use `Schema.Union` for several). */
    readonly error: <E extends Schema.Top>(
      schema: E,
    ) => Builder<Payload, Success, E, Middleware, Requires>;
    /** Adds `effect/rpc` middleware (applied after earlier middleware). */
    readonly middleware: <M extends RpcMiddleware.AnyService>(
      middleware: M,
    ) => Builder<
      Payload,
      Success,
      Error,
      Middleware | M,
      RpcMiddleware.ApplyServices<M['Identifier'], Requires>
    >;
    /** Finishes a query whose handler returns an `Effect`. */
    readonly query: <R = never>(
      handler: EffectHandler<Payload, Success, Error, Middleware, R>,
    ) => ProcedureWithHandler<'query', Payload, Success, Error, Middleware, Requires, R>;
    /** Finishes a mutation whose handler returns an `Effect`. */
    readonly mutation: <R = never>(
      handler: EffectHandler<Payload, Success, Error, Middleware, R>,
    ) => ProcedureWithHandler<'mutation', Payload, Success, Error, Middleware, Requires, R>;
    /** Finishes a subscription whose handler returns a `Stream` of elements. */
    readonly subscription: <R = never>(
      handler: StreamHandler<Payload, Success, Error, Middleware, R>,
    ) => ProcedureWithHandler<'subscription', Payload, Success, Error, Middleware, Requires, R>;
  }
}

interface BuilderState {
  readonly payload: PayloadInput;
  readonly success: Schema.Top;
  readonly error: Schema.Top;
  readonly middlewares: ReadonlyArray<RpcMiddleware.AnyService>;
}

type AnyHandler = (...args: ReadonlyArray<never>) => unknown;

const finish = (kind: ProcedureKind.Value, state: BuilderState, handler: AnyHandler): any => {
  // Same path as `query({...}).middleware(...)`: `define`, then one `middleware` per step.
  let def: ProcedureDef.Any = define(kind, {
    payload: state.payload,
    success: state.success,
    error: state.error,
    handler,
  });
  for (const middleware of state.middlewares) def = addDefMiddleware(def, middleware);
  return def;
};

// Returns `any`: `Procedure` below assigns the precise `Procedure.Builder<...>` type.
const makeBuilder = (state: BuilderState): any =>
  Object.freeze({
    input: (payload: PayloadInput) => makeBuilder({ ...state, payload }),
    output: (success: Schema.Top) => makeBuilder({ ...state, success }),
    error: (error: Schema.Top) => makeBuilder({ ...state, error }),
    middleware: (middleware: RpcMiddleware.AnyService) =>
      makeBuilder({ ...state, middlewares: [...state.middlewares, middleware] }),
    query: (handler: AnyHandler) => finish('query', state, handler),
    mutation: (handler: AnyHandler) => finish('mutation', state, handler),
    subscription: (handler: AnyHandler) => finish('subscription', state, handler),
  });

const empty: Procedure.Builder<Schema.Void, Schema.Void, Schema.Never, never, never> = makeBuilder({
  payload: Schema.Void,
  success: Schema.Void,
  error: Schema.Never,
  middlewares: [],
});

/**
 * Returns `true` when `u` is a procedure built with {@link Procedure} (it carries a `handler`);
 * `false` for `query({...})` definitions and anything else.
 *
 * **Example** (Telling builder procedures from plain definitions)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { Procedure, query } from '@effect-trpc/core';
 *
 * Procedure.hasHandler(Procedure.query(() => Effect.void)); // true
 * Procedure.hasHandler(query({ success: Schema.String })); // false
 * ```
 *
 * @category guards
 * @since 0.1.0
 */
const hasHandler = (u: unknown): u is ProcedureWithHandler.Any =>
  isProcedureDef(u) && Predicate.hasProperty(u, 'handler') && typeof u.handler === 'function';

/**
 * The tRPC-style procedure builder: declare `input`, `output`, `error` and `middleware` in any
 * order, then finish with `query`, `mutation` or `subscription` and the handler.
 *
 * **When to use**
 *
 * Use it to write a router once, with schemas and implementation side by side (typically in the
 * `make` of a router service). Prefer `query({...})` / `mutation({...})` / `subscription({...})`
 * when the router must stay schema-only (implemented separately with `Handlers.make`).
 *
 * **Details**
 *
 * - Every step is optional; defaults match `query({...})`: input `Schema.Void`, output
 *   `Schema.Void`, error `Schema.Never`. `input` accepts a schema or `Schema.Struct` fields.
 * - The handler is contextually typed: `(payload, ctx)` where `payload` is the decoded input and
 *   `ctx` is {@link Procedure.HandlerContext}. It must succeed with the decoded output and may
 *   fail only with the declared `error` or the errors of middleware added before the terminal.
 * - The handler's requirements are inferred and recorded on the procedure
 *   ({@link Procedure.HandlerRequirements}); read services inside the handler with `yield*`.
 * - Subscription handlers return a `Stream` of output elements.
 * - The result compiles to the same rpc as the equivalent `query({...})`; `.middleware(M)` on it
 *   (or `router.middleware(M)`) keeps the handler.
 * - Builders are immutable and frozen; `Procedure.hasHandler(u)` is the runtime guard.
 *
 * **Gotchas**
 *
 * - Calling `input`, `output` or `error` twice replaces the earlier schema (use `Schema.Union`
 *   for several errors); `middleware` accumulates.
 * - Middleware added after the terminal does not widen what the already-typed handler may fail
 *   with: add middleware before the terminal when the handler fails with its errors.
 * - The handler closure ships wherever the procedure is imported (including browser bundles):
 *   keep secrets in services and read them inside the handler.
 *
 * **Example** (A router written once)
 *
 * ```ts
 * import { Context, Effect, Schema, Stream } from 'effect';
 * import { Procedure, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Finite, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Finite,
 * }) {}
 * class Database extends Context.Service<
 *   Database,
 *   {
 *     readonly findPost: (id: number) => Effect.Effect<Post, PostNotFound>;
 *     readonly createPost: (title: string) => Effect.Effect<Post>;
 *   }
 * >()('Database') {}
 *
 * export const appRouter = Router.make({
 *   health: Procedure.output(Schema.Literal('ok')).query(() => Effect.succeed('ok' as const)),
 *   post: {
 *     byId: Procedure.input({ id: Schema.Finite })
 *       .output(Post)
 *       .error(PostNotFound)
 *       .query(
 *         Effect.fn(function* ({ id }) {
 *           const db = yield* Database; // services are read inside the handler
 *           return yield* db.findPost(id);
 *         }),
 *       ),
 *     create: Procedure.input({ title: Schema.String })
 *       .output(Post)
 *       .mutation(({ title }) => Database.use((db) => db.createPost(title))),
 *     ticks: Procedure.input({ upTo: Schema.Finite })
 *       .output(Schema.Finite)
 *       .subscription(({ upTo }) => Stream.range(1, upTo)),
 *   },
 * });
 *
 * type Services = Procedure.HandlerRequirements<typeof appRouter.record.post.byId>; // Database
 * ```
 *
 * @see {@link ProcedureWithHandler}
 * @category constructors
 * @since 0.1.0
 */
export const Procedure = {
  input: empty.input,
  output: empty.output,
  error: empty.error,
  middleware: empty.middleware,
  query: empty.query,
  mutation: empty.mutation,
  subscription: empty.subscription,
  hasHandler,
} as const;
