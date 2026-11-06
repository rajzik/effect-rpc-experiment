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
import { Context, Effect, Predicate, Schema, Stream } from 'effect';
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
 * - `.middleware(M)`, `.annotate(key, value)` and `router.middleware(M)` keep the handler (value
 *   and type).
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
  /** Returns a new procedure annotated with `key` = `value`; the handler and type are kept. */
  annotate<I, S>(
    key: Context.Key<I, S>,
    value: NoInfer<S>,
  ): ProcedureWithHandler<Kind, Payload, Success, Error, Middleware, Requires, HandlerR>;
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
   * What a builder still infers from its handler. A fresh builder infers both: `'output'` until
   * `.output(...)` or `.inferred({ output })` sets the output schema, `'error'` until `.error(...)`
   * or `.output(...)` makes the failures checked. `never` is the fully explicit builder.
   *
   * @since 0.1.0
   */
  export type Infer = 'output' | 'error';

  /**
   * The success schema type of a procedure whose output is inferred from a handler succeeding
   * with `A`: `Schema.Void` for `void` (and `undefined` / `never`), else a `Schema.declare<A>`
   * that carries `A` for the client types. At runtime the schema is `Schema.Void`; a handler
   * value other than `undefined` is a defect until `@effect-trpc/codegen` (or `.output`) sets
   * a real schema.
   *
   * @since 0.1.0
   */
  export type InferredSuccess<A> = [A] extends [void] ? Schema.Void : Schema.declare<A>;

  /**
   * The argument of `.inferred(...)`: the schemas the generator derived from the handler types.
   *
   * @since 0.1.0
   */
  export interface InferredSchemas {
    readonly output?: Schema.Top;
    readonly error?: Schema.Top;
  }

  /**
   * The upper bound of a terminal's handler result while the builder infers (see {@link Infer}):
   * the success is free while `'output'` is inferred, the failures while `'error'` is.
   *
   * @since 0.1.0
   */
  export type InferBound<
    Kind extends ProcedureKind.Value,
    Success extends Schema.Top,
    Error extends Schema.Top,
    Middleware extends RpcMiddleware.AnyService,
    Infer_ extends Infer,
  > = Kind extends 'subscription'
    ? Stream.Stream<
        'output' extends Infer_ ? unknown : Success['Type'],
        'error' extends Infer_ ? unknown : HandlerError<Error, Middleware>,
        unknown
      >
    : Effect.Effect<
        'output' extends Infer_ ? unknown : Success['Type'],
        'error' extends Infer_ ? unknown : HandlerError<Error, Middleware>,
        unknown
      >;

  /**
   * A terminal (`query`, `mutation`, `subscription`) of a {@link Builder}. An explicit builder
   * types the handler from its schemas; an inferring one infers the handler's whole result (so
   * the failures of a `cond ? Effect.fail(a) : Effect.fail(b)` handler union) and reads the
   * success and services from it.
   *
   * @since 0.1.0
   */
  export type Terminal<
    Kind extends ProcedureKind.Value,
    Payload extends Schema.Top,
    Success extends Schema.Top,
    Error extends Schema.Top,
    Middleware extends RpcMiddleware.AnyService,
    Requires,
    Infer_ extends Infer,
  > = [Infer_] extends [never]
    ? <R = never>(
        handler: Handler<Kind, Payload, Success, Error, Middleware, R>,
      ) => ProcedureWithHandler<Kind, Payload, Success, Error, Middleware, Requires, R>
    : <Out extends InferBound<Kind, Success, Error, Middleware, Infer_>>(
        handler: (payload: Payload['Type'], ctx: HandlerContext) => Out,
      ) => ProcedureWithHandler<
        Kind,
        Payload,
        'output' extends Infer_
          ? InferredSuccess<Kind extends 'subscription' ? Stream.Success<Out> : Effect.Success<Out>>
          : Success,
        Error,
        Middleware,
        Requires,
        Kind extends 'subscription' ? Stream.Services<Out> : Effect.Services<Out>
      >;

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
    Infer_ extends Infer = never,
  > {
    /** Sets the input: a schema or `Schema.Struct` fields (replaces an earlier `input`). */
    readonly input: <P extends PayloadInput>(
      input: P,
    ) => Builder<NormalizePayload<P>, Success, Error, Middleware, Requires, Infer_>;
    /**
     * Sets the success schema (for subscriptions: each element; replaces an earlier `output`).
     * The builder becomes explicit: the handler's output and failures are checked.
     */
    readonly output: <S extends Schema.Top>(
      schema: S,
    ) => Builder<Payload, S, Error, Middleware, Requires>;
    /** Sets the typed error schema (replaces an earlier `error`; use `Schema.Union` for several). */
    readonly error: <E extends Schema.Top>(
      schema: E,
    ) => Builder<Payload, Success, E, Middleware, Requires, Exclude<Infer_, 'error'>>;
    /**
     * Sets the schemas inferred from the handler (what `@effect-trpc/codegen` applies through
     * `Router.withSchemas`). By hand, use `.output` / `.error`. The output is checked; failures not in
     * `error` stay allowed (they reach the client as defects).
     */
    readonly inferred: <const S extends InferredSchemas>(
      schemas: S,
    ) => Builder<
      Payload,
      S extends { readonly output: infer O extends Schema.Top } ? O : Success,
      S extends { readonly error: infer X extends Schema.Top } ? X : Error,
      Middleware,
      Requires,
      S extends { readonly output: Schema.Top } ? Exclude<Infer_, 'output'> : Infer_
    >;
    /** Adds `effect/rpc` middleware (applied after earlier middleware). */
    readonly middleware: <M extends RpcMiddleware.AnyService>(
      middleware: M,
    ) => Builder<
      Payload,
      Success,
      Error,
      Middleware | M,
      RpcMiddleware.ApplyServices<M['Identifier'], Requires>,
      Infer_
    >;
    /**
     * Annotates the procedure with `key` = `value` (tRPC's `.meta()`), read by middleware from
     * `rpc.annotations`. The builder type is unchanged; a later value of the same key wins.
     */
    readonly annotate: <I, S>(
      key: Context.Key<I, S>,
      value: NoInfer<S>,
    ) => Builder<Payload, Success, Error, Middleware, Requires, Infer_>;
    /** Finishes a query whose handler returns an `Effect`. */
    readonly query: Terminal<'query', Payload, Success, Error, Middleware, Requires, Infer_>;
    /** Finishes a mutation whose handler returns an `Effect`. */
    readonly mutation: Terminal<'mutation', Payload, Success, Error, Middleware, Requires, Infer_>;
    /** Finishes a subscription whose handler returns a `Stream` of elements. */
    readonly subscription: Terminal<
      'subscription',
      Payload,
      Success,
      Error,
      Middleware,
      Requires,
      Infer_
    >;
  }
}

interface BuilderState {
  readonly payload: PayloadInput;
  readonly success: Schema.Top;
  readonly error: Schema.Top;
  readonly middlewares: ReadonlyArray<RpcMiddleware.AnyService>;
  readonly annotations: Context.Context<never>;
  /** No output schema yet: the success type is inferred and the runtime schema is `Void`. */
  readonly inferOutput: boolean;
}

type AnyHandler = (...args: ReadonlyArray<never>) => unknown;
type RuntimeHandler = (payload: unknown, ctx: Procedure.HandlerContext) => unknown;

const missingOutputSchema = (): Error =>
  new Error(
    'effect-trpc: this procedure has no output schema, so the value its handler returned cannot ' +
      'be sent. Add `.output(schema)` to the procedure, or generate the schemas from the handler ' +
      'types with `effect-trpc-codegen` (@effect-trpc/codegen) and serve the generated router.',
  );

const checkVoid = (value: unknown): Effect.Effect<unknown> =>
  value === undefined ? Effect.succeed(value) : Effect.die(missingOutputSchema());

// Without an output schema the success is encoded with `Schema.Void`, which turns any value into
// `null`: fail loudly instead of sending `undefined` to a client typed with the handler's value.
interface DefFields {
  readonly payloadSchema: Schema.Top;
  readonly successSchema: Schema.Top;
  readonly errorSchema: Schema.Top;
  readonly middlewares: ReadonlyArray<RpcMiddleware.AnyService>;
  readonly annotations: Context.Context<never>;
}

/** Guarded handler -> the handler as written (for `withInferredSchemas`). */
const originalHandlers = new WeakMap<RuntimeHandler, AnyHandler>();

const guardInferredOutput = (kind: ProcedureKind.Value, handler: AnyHandler): RuntimeHandler => {
  const guarded: RuntimeHandler = (payload, ctx) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the builder's typed terminal guarantees the handler's signature for this kind
    const run = handler as unknown as RuntimeHandler;
    // The services (`R`) are erased: the server provides them; only the success is inspected.
    return kind === 'subscription'
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a subscription handler returns a Stream (typed terminal)
        Stream.mapEffect(run(payload, ctx) as Stream.Stream<unknown, unknown>, checkVoid)
      : // oxlint-disable-next-line typescript/no-unsafe-type-assertion, effecttsgo/any-unknown-in-error-context -- a query/mutation handler returns an Effect (typed terminal); its failures pass through untouched, so the error type is erased
        Effect.flatMap(run(payload, ctx) as Effect.Effect<unknown, unknown>, checkVoid);
  };
  originalHandlers.set(guarded, handler);
  return guarded;
};

/**
 * @internal Re-creates a builder procedure with the given schemas, as `.inferred(schemas)` before its
 * terminal would have: the handler as written (without the inference guard once an output is
 * given) and the same kind, payload, middleware and annotations. Used by `Router.withSchemas`.
 */
export const withInferredSchemas = (
  procedure: ProcedureWithHandler.Any,
  schemas: Procedure.InferredSchemas,
): ProcedureWithHandler.Any => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every procedure carries these fields; `ProcedureDef.Any` only brands it
  const fields = procedure as unknown as DefFields;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- erased handler: the map is keyed by the same function value
  const current = procedure.handler as unknown as RuntimeHandler;
  const handler =
    schemas.output === undefined ? current : (originalHandlers.get(current) ?? current);
  let def: ProcedureDef.Any = define(procedure.kind, {
    payload: fields.payloadSchema,
    success: schemas.output ?? fields.successSchema,
    error: schemas.error ?? fields.errorSchema,
    annotations: fields.annotations,
    handler,
  });
  for (const middleware of fields.middlewares) def = addDefMiddleware(def, middleware);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `define` with a handler creates a procedure with a handler
  return def as ProcedureWithHandler.Any;
};

const finish = (kind: ProcedureKind.Value, state: BuilderState, handler: AnyHandler): any => {
  // Same path as `query({...}).middleware(...)`: `define`, then one `middleware` per step.
  let def: ProcedureDef.Any = define(kind, {
    payload: state.payload,
    success: state.success,
    error: state.error,
    annotations: state.annotations,
    handler: state.inferOutput ? guardInferredOutput(kind, handler) : handler,
  });
  for (const middleware of state.middlewares) def = addDefMiddleware(def, middleware);
  return def;
};

// Returns `any`: `Procedure` below assigns the precise `Procedure.Builder<...>` type.
const makeBuilder = (state: BuilderState): any =>
  Object.freeze({
    input: (payload: PayloadInput) => makeBuilder({ ...state, payload }),
    output: (success: Schema.Top) => makeBuilder({ ...state, success, inferOutput: false }),
    error: (error: Schema.Top) => makeBuilder({ ...state, error }),
    inferred: (schemas: Procedure.InferredSchemas) =>
      makeBuilder({
        ...state,
        ...(schemas.output === undefined ? {} : { success: schemas.output, inferOutput: false }),
        ...(schemas.error === undefined ? {} : { error: schemas.error }),
      }),
    middleware: (middleware: RpcMiddleware.AnyService) =>
      makeBuilder({ ...state, middlewares: [...state.middlewares, middleware] }),
    annotate: <I, S>(key: Context.Key<I, S>, value: S) =>
      makeBuilder({ ...state, annotations: Context.add(state.annotations, key, value) }),
    query: (handler: AnyHandler) => finish('query', state, handler),
    mutation: (handler: AnyHandler) => finish('mutation', state, handler),
    subscription: (handler: AnyHandler) => finish('subscription', state, handler),
  });

const empty: Procedure.Builder<
  Schema.Void,
  Schema.Void,
  Schema.Never,
  never,
  never,
  Procedure.Infer
> = makeBuilder({
  payload: Schema.Void,
  success: Schema.Void,
  error: Schema.Never,
  middlewares: [],
  annotations: Context.empty(),
  inferOutput: true,
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
 * The tRPC-style procedure builder: declare `input`, `output`, `error`, `middleware` and
 * `annotate` in any order, then finish with `query`, `mutation` or `subscription` and the handler.
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
 *   `ctx` is {@link Procedure.HandlerContext}. With `.output(...)` it must succeed with the
 *   decoded output and may fail only with the declared `error` or the errors of middleware added
 *   before the terminal.
 * - Without `.output(...)` the builder is in inference mode: the output type is the handler's
 *   success type (`inferOutput` gives it), and the handler may fail with anything unless
 *   `.error(...)` was set (then failures stay checked). The schemas themselves come from
 *   `@effect-trpc/codegen`, which reads the handler types and writes `router.gen.ts`
 *   (`Router.withSchemas` over the router: serve it) and `router.client.gen.ts` (the
 *   handler-free contract: give it to clients). `.inferred({ output, error })` is the same step
 *   on a single chain; by hand, write `.output` / `.error`.
 * - The handler's requirements are inferred and recorded on the procedure
 *   ({@link Procedure.HandlerRequirements}); read services inside the handler with `yield*`.
 * - Subscription handlers return a `Stream` of output elements.
 * - The result compiles to the same rpc as the equivalent `query({...})`; `.middleware(M)` on it
 *   (or `router.middleware(M)`) keeps the handler.
 * - `.annotate(key, value)` is tRPC's `.meta()`: metadata on the compiled rpc, read by middleware
 *   with `Context.get(rpc.annotations, key)` (see `ProcedureDef`). It never changes the types.
 * - Builders are immutable and frozen; `Procedure.hasHandler(u)` is the runtime guard.
 *
 * **Gotchas**
 *
 * - Calling `input`, `output` or `error` twice replaces the earlier schema (use `Schema.Union`
 *   for several errors); `middleware` accumulates.
 * - In inference mode, without the generated schemas, a handler returning a value other than
 *   `undefined` dies with a defect naming the fix (the runtime output schema is still
 *   `Schema.Void`, which would drop the value), and every failure reaches the client as a defect.
 *   Failures not declared in `.inferred({ error })` (e.g. a `Data.TaggedError`) are defects too.
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
 * **Example** (Inference mode and the generated step)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { Procedure } from '@effect-trpc/core';
 * import type { inferError, inferOutput } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Finite, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Finite,
 * }) {}
 *
 * const find = (id: number) =>
 *   id === 1
 *     ? Effect.succeed(new Post({ id, title: 'Hello' }))
 *     : Effect.fail(new PostNotFound({ id }));
 *
 * // As written: no `.output` / `.error`; the types come from the handler.
 * const byId = Procedure.input({ id: Schema.Finite }).query(({ id }) => find(id));
 * type Output = inferOutput<typeof byId>; // Post
 *
 * // As generated: the same chain with the inferred schemas.
 * const generated = Procedure.input({ id: Schema.Finite })
 *   .inferred({ output: Post, error: PostNotFound })
 *   .query(({ id }) => find(id));
 * type Failure = inferError<typeof generated>; // PostNotFound
 * ```
 *
 * **Example** (Meta for middleware)
 *
 * ```ts
 * import { Context, Effect, Layer, Schema } from 'effect';
 * import { RpcMiddleware } from 'effect/rpc';
 * import { Procedure, Router } from '@effect-trpc/core';
 *
 * class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {}) {}
 * class RequireRoles extends RpcMiddleware.Service<RequireRoles>()('RequireRoles', {
 *   error: Forbidden,
 * }) {}
 * const Roles = Context.Reference<ReadonlyArray<string>>('Roles', { defaultValue: () => [] });
 *
 * export const appRouter = Router.make({
 *   stats: Procedure.annotate(Roles, ['admin'])
 *     .output(Schema.Finite)
 *     .query(() => Effect.succeed(42)),
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
 * @see {@link ProcedureWithHandler}
 * @category constructors
 * @since 0.1.0
 */
export const Procedure = {
  input: empty.input,
  output: empty.output,
  error: empty.error,
  inferred: empty.inferred,
  middleware: empty.middleware,
  annotate: empty.annotate,
  query: empty.query,
  mutation: empty.mutation,
  subscription: empty.subscription,
  hasHandler,
} as const;
