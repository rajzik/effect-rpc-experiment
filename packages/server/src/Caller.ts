/**
 * Calls a router's procedures in-process, without HTTP or serialization (tRPC's `createCaller`).
 *
 * `createCaller` wires the router's `RpcGroup` to its handler layer through `effect/rpc`'s
 * `RpcTest.makeClient`, so the router's middleware still runs and per-call headers reach it. The
 * result mirrors the router twice: as `Effect`s / `Stream`s at the root and as `Promise`s /
 * `AsyncIterable`s under `$promise`. Use it in tests, scripts, SSR and server-to-server calls;
 * use `@effect-trpc/client` with `localLink` when code must be written against the client API.
 *
 * @since 0.1.0
 */
import { Context, Effect, Exit, Layer, ManagedRuntime, Stream } from 'effect';
import type { Headers } from 'effect/http';
import { RpcTest } from 'effect/rpc';
import type { Rpc, RpcGroup } from 'effect/rpc';
import { causeToClientError, RpcInterrupted } from '@effect-trpc/core';
import type {
  inferError,
  inferInput,
  inferKind,
  inferOutput,
  ProcedureDef,
  ProcedureInfo,
  Router,
} from '@effect-trpc/core';
import type { Handlers } from './Handlers.js';

/**
 * Per-call options of the Effect caller (`caller.post.byId(input, options)`).
 *
 * **When to use**
 *
 * Pass `headers` to simulate request headers, e.g. the `authorization` header an auth middleware
 * reads. Cancel an Effect call by interrupting its fiber; there is no `signal` here.
 *
 * **Example** (Calling a procedure behind an auth middleware)
 *
 * ```ts
 * import { Effect } from 'effect';
 * import type { CallOptions } from '@effect-trpc/server';
 *
 * declare const caller: {
 *   readonly user: {
 *     readonly me: (input: void, options?: CallOptions) => Effect.Effect<string>;
 *   };
 * };
 *
 * const options: CallOptions = { headers: { 'x-user': 'grace' } };
 * const program = caller.user.me(undefined, options);
 * ```
 *
 * @see {@link PromiseCallOptions}
 * @category options
 * @since 0.1.0
 */
export interface CallOptions {
  /** Request headers, visible to middleware and to handlers (`ctx.headers`). */
  readonly headers?: Headers.Input | undefined;
}

/**
 * Per-call options of the Promise caller (`caller.$promise.post.byId(input, options)`).
 *
 * **Details**
 *
 * - `headers` reach middleware and handlers exactly like {@link CallOptions}.
 * - Aborting `signal` interrupts the handler; the promise rejects with `RpcInterrupted` and a
 *   subscription's iterator throws `RpcInterrupted`. For queries and mutations, an already
 *   aborted signal rejects immediately without running the handler.
 *
 * @see {@link CallOptions}
 * @category options
 * @since 0.1.0
 */
export interface PromiseCallOptions extends CallOptions {
  /** Aborting interrupts the handler; the promise rejects with `RpcInterrupted`. */
  readonly signal?: AbortSignal | undefined;
}

type RecordOf<R> = R extends Router<infer Rec> ? Rec : R;

/**
 * The Effect-returning call signature of one procedure on a {@link Caller}.
 *
 * **Details**
 *
 * - Queries and mutations return `Effect<A, E>`, subscriptions return `Stream<A, E>`, where `E`
 *   is exactly the procedure's typed errors (including middleware errors). There is no
 *   `RpcTransportError`: the call never leaves the process.
 * - Handler defects (thrown exceptions, `Effect.die`, invalid input) are defects of the returned
 *   Effect, and interrupting the fiber interrupts the handler.
 * - Procedures without a payload take `void`: call them with no arguments (`caller.health()`),
 *   or with `undefined` when passing options.
 *
 * @see {@link PromiseProcedure}
 * @category type-level
 * @since 0.1.0
 */
export type EffectProcedure<D extends ProcedureDef.Any> =
  inferKind<D> extends 'subscription'
    ? (input: inferInput<D>, options?: CallOptions) => Stream.Stream<inferOutput<D>, inferError<D>>
    : (input: inferInput<D>, options?: CallOptions) => Effect.Effect<inferOutput<D>, inferError<D>>;

/**
 * The Promise-returning call signature of one procedure on `caller.$promise`.
 *
 * **Details**
 *
 * - Queries and mutations return a `Promise` that rejects with a `ClientError<E>` instance:
 *   the procedure's own error, or `RpcDefect` (handler died, invalid input or output) /
 *   `RpcInterrupted` (aborted, or the caller was disposed).
 * - Subscriptions return an `AsyncIterable` whose iteration throws `ClientError<E>`; breaking
 *   out of a `for await` loop finalizes the server stream.
 *
 * @see {@link EffectProcedure}
 * @category type-level
 * @since 0.1.0
 */
export type PromiseProcedure<D extends ProcedureDef.Any> =
  inferKind<D> extends 'subscription'
    ? (input: inferInput<D>, options?: PromiseCallOptions) => AsyncIterable<inferOutput<D>>
    : (input: inferInput<D>, options?: PromiseCallOptions) => Promise<inferOutput<D>>;

type EffectRecord<Rec> = {
  readonly [K in keyof Rec]: Rec[K] extends ProcedureDef.Any
    ? EffectProcedure<Rec[K]>
    : EffectRecord<RecordOf<Rec[K]>>;
};

type PromiseRecord<Rec> = {
  readonly [K in keyof Rec]: Rec[K] extends ProcedureDef.Any
    ? PromiseProcedure<Rec[K]>
    : PromiseRecord<RecordOf<Rec[K]>>;
};

/**
 * The Promise half of a {@link Caller}: `caller.$promise.post.byId(input, { signal })`.
 *
 * @see {@link PromiseProcedure}
 * @category models
 * @since 0.1.0
 */
export type PromiseCaller<R extends Router.Any> = PromiseRecord<R['record']>;

/**
 * An in-process typed caller for a router (no serialization; the router's middleware runs).
 *
 * **Details**
 *
 * - `caller.post.byId(input, { headers? })` returns `Effect<A, E>`; subscriptions return
 *   `Stream<A, E>`.
 * - `caller.$promise.post.byId(input, { signal?, headers? })` returns a `Promise<A>` rejecting
 *   with `ClientError<E>`; subscriptions return `AsyncIterable<A>`.
 * - `caller.$router` is the router; `caller.dispose()` (or `await using`) releases the handler
 *   layer.
 *
 * **Gotchas**
 *
 * - `$promise`, `$router` and `dispose` are reserved on the root, so a router must not use them
 *   as top-level keys.
 * - The caller is not thenable (`then` resolves to `undefined`), so returning it from an async
 *   function is safe.
 *
 * @see {@link createCaller}
 * @category models
 * @since 0.1.0
 */
export type Caller<R extends Router.Any> = EffectRecord<R['record']> & {
  readonly $promise: PromiseCaller<R>;
  /** The router this caller was created for. */
  readonly $router: R;
  /** Releases the handler layer (its finalizers run). Later calls are interrupted. */
  readonly dispose: () => Promise<void>;
  readonly [Symbol.asyncDispose]: () => Promise<void>;
};

/**
 * Options of {@link createCaller}.
 *
 * **Gotchas**
 *
 * - `handlers` must also provide every middleware implementation (`Layer.mergeAll(HandlersLive,
 *   AuthLive)`); a missing one is a compile error, not a runtime failure.
 *
 * @see {@link Caller.Requirements}
 * @category options
 * @since 0.1.0
 */
export interface CallerOptions<R extends Router.Any, LE> {
  /**
   * Layer providing every handler of the router, the server implementation of every middleware
   * it uses and, for middleware marked `requiredForClient`, its client implementation.
   */
  readonly handlers: Layer.Layer<Caller.Requirements<R>, LE>;
}

/**
 * Type-level helpers of {@link Caller}.
 *
 * @category type-level
 * @since 0.1.0
 */
export declare namespace Caller {
  /**
   * What the handler layer of a caller must provide: {@link Handlers.Requirements} plus the
   * client implementations of `requiredForClient` middleware.
   *
   * @since 0.1.0
   */
  export type Requirements<R extends Router.Any> =
    | Handlers.Requirements<R>
    | Rpc.MiddlewareClient<Router.Rpcs<R>>;
}

type FlatClient = (
  tag: string,
  payload: unknown,
  options?: { readonly headers?: Headers.Input | undefined },
) => unknown;

/** The in-process `effect/rpc` client, split by procedure kind. */
interface CallerClientShape {
  readonly unary: (
    tag: string,
    payload: unknown,
    options: CallOptions | undefined,
  ) => Effect.Effect<unknown, unknown>;
  readonly stream: (
    tag: string,
    payload: unknown,
    options: CallOptions | undefined,
  ) => Stream.Stream<unknown, unknown>;
}

class CallerClient extends Context.Service<CallerClient, CallerClientShape>()(
  '@effect-trpc/server/CallerClient',
) {}

const reservedKeys: ReadonlySet<string | symbol> = new Set(['then', 'toJSON', 'valueOf']);

const callHeaders = (options: CallOptions | undefined): CallOptions | undefined =>
  options?.headers === undefined ? undefined : { headers: options.headers };

const rejectWithClientError = <A>(exit: Exit.Exit<A, unknown>): A => {
  if (Exit.isSuccess(exit)) return exit.value;
  throw causeToClientError(exit.cause);
};

/**
 * Creates an in-process caller for a router (tRPC's `createCaller`): calls go straight to the
 * handlers through `RpcTest.makeClient` (no HTTP, no serialization), but the router's middleware
 * still runs and per-call headers reach it.
 *
 * **When to use**
 *
 * Use in tests, scripts, server-side rendering and server-to-server calls inside one process.
 * Prefer `createClient(router, { link: localLink({ handlers }) })` from `@effect-trpc/client`
 * when the calling code should use the client API (`$effect`, `withHeaders`,
 * `RpcTransportError`), and {@link toWebHandler} / `layerHttp` to serve real HTTP clients.
 *
 * **Details**
 *
 * - The handler layer is built lazily on the first call and shared by all calls until
 *   `dispose()`. Layer construction failures surface as defects (`RpcDefect` for promises).
 * - Values are passed by reference: a `Schema.Class` result is the very instance the handler
 *   returned. Input is still decoded with the payload schema, so invalid input is a defect.
 * - `dispose()` interrupts in-flight calls and runs the layer's finalizers; later calls are
 *   interrupted (`RpcInterrupted` for promises) instead of hanging.
 *
 * **Gotchas**
 *
 * - Calling a path that is not a procedure of the router throws an `Error` synchronously.
 * - `handlers` must include the middleware implementations, not only `Handlers.make(...)`.
 *
 * **Example** (Calling procedures in-process with the Effect and Promise APIs)
 *
 * ```ts
 * import { Context, Effect, Layer, Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { createCaller, Handlers, Middleware } from '@effect-trpc/server';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 * class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}
 *
 * class CurrentUser extends Context.Service<CurrentUser, { readonly name: string }>()(
 *   'CurrentUser',
 * ) {}
 * class Auth extends Middleware.make<Auth, { provides: CurrentUser }>()('Auth', {
 *   error: Unauthorized,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 *   me: query({ success: Schema.String }).middleware(Auth),
 * });
 *
 * const AuthLive = Layer.succeed(Auth)(
 *   Auth.of((effect, { headers }) => {
 *     const name = headers['x-user'];
 *     return name === undefined
 *       ? Effect.fail(new Unauthorized())
 *       : Effect.provideService(effect, CurrentUser, { name });
 *   }),
 * );
 * const HandlersLive = Handlers.make(appRouter, {
 *   post: {
 *     byId: ({ id }) =>
 *       id === 1 ? Effect.succeed(new Post({ id, title: 'Hello' })) : Effect.fail(new PostNotFound({ id })),
 *   },
 *   me: () =>
 *     Effect.gen(function* () {
 *       const user = yield* CurrentUser; // provided by the Auth middleware
 *       return user.name;
 *     }),
 * });
 *
 * // The middleware implementation travels with the handlers.
 * const caller = createCaller(appRouter, { handlers: Layer.mergeAll(HandlersLive, AuthLive) });
 *
 * // Promise API: rejects with ClientError<PostNotFound | ...>.
 * const post = await caller.$promise.post.byId({ id: 1 });
 * const me = await caller.$promise.me(undefined, { headers: { 'x-user': 'ada' } });
 *
 * // Effect API: typed errors, no requirements.
 * const title = caller.post
 *   .byId({ id: 2 })
 *   .pipe(
 *     Effect.map((p) => p.title),
 *     Effect.catchTag('PostNotFound', () => Effect.succeed('missing')),
 *   );
 * await Effect.runPromise(title);
 *
 * await caller.dispose();
 * ```
 *
 * @see {@link Caller}
 * @see {@link Handlers}
 * @category constructors
 * @since 0.1.0
 */
export const createCaller = <R extends Router.Any, LE = never>(
  router: R,
  options: CallerOptions<R, LE>,
): Caller<R> => {
  // `RpcTest.makeClient` wires an in-memory RpcServer to an RpcClient: no serialization.
  const makeClient = RpcTest.makeClient(router.group as RpcGroup.RpcGroup<Rpc.AnyWithProps>, {
    flatten: true,
  });
  const clientLayer = Layer.effect(CallerClient)(
    Effect.map(makeClient, (flat) => {
      const client = flat as unknown as FlatClient;
      return CallerClient.of({
        unary: (tag, payload, opts) =>
          client(tag, payload, opts) as Effect.Effect<unknown, unknown>,
        stream: (tag, payload, opts) =>
          client(tag, payload, opts) as Stream.Stream<unknown, unknown>,
      });
    }),
  );
  const runtime = ManagedRuntime.make(clientLayer.pipe(Layer.provide(options.handlers)));
  let disposed: Promise<void> | undefined;
  const builtClient = Effect.orDie(
    Effect.map(runtime.contextEffect, (context) => Context.get(context, CallerClient)),
  );
  // After dispose() the runtime must not be used again (it would hang): calls are interrupted.
  const clientEffect = Effect.suspend(() =>
    disposed === undefined ? builtClient : Effect.interrupt,
  );

  const lookup = (path: ReadonlyArray<string>): ProcedureInfo => {
    const info = router.procedures.get(path.join('.'));
    if (info === undefined || info.path.length !== path.length) {
      throw new Error(`Unknown procedure "${path.join('.')}"`);
    }
    return info;
  };

  const callUnary = (
    info: ProcedureInfo,
    payload: unknown,
    callOptions: CallOptions | undefined,
  ): Effect.Effect<unknown, unknown> =>
    Effect.flatMap(clientEffect, (client) =>
      client.unary(info.tag, payload, callHeaders(callOptions)),
    );

  const callStream = (
    info: ProcedureInfo,
    payload: unknown,
    callOptions: CallOptions | undefined,
  ): Stream.Stream<unknown, unknown> =>
    Stream.unwrap(
      Effect.map(clientEffect, (client) =>
        client.stream(info.tag, payload, callHeaders(callOptions)),
      ),
    );

  const callEffect = (
    info: ProcedureInfo,
    payload: unknown,
    callOptions: CallOptions | undefined,
  ): Effect.Effect<unknown, unknown> | Stream.Stream<unknown, unknown> =>
    info.kind === 'subscription'
      ? callStream(info, payload, callOptions)
      : callUnary(info, payload, callOptions);

  const callPromise = (
    info: ProcedureInfo,
    payload: unknown,
    callOptions: PromiseCallOptions | undefined,
  ): Promise<unknown> | AsyncIterable<unknown> => {
    const signal = callOptions?.signal;
    const runOptions = signal === undefined ? undefined : { signal };
    if (info.kind === 'subscription') {
      let stream = callStream(info, payload, callOptions);
      if (signal !== undefined) {
        stream = stream.pipe(
          Stream.interruptWhen(
            Effect.andThen(abortEffect(signal), Effect.fail(new RpcInterrupted())),
          ),
        );
      }
      return Stream.toAsyncIterable(
        stream.pipe(Stream.catchCause((cause) => Stream.fail(causeToClientError(cause)))),
      );
    }
    if (signal?.aborted === true || disposed !== undefined) {
      return Promise.reject(new RpcInterrupted());
    }
    return runtime
      .runPromiseExit(callUnary(info, payload, callOptions), runOptions)
      .then(rejectWithClientError);
  };

  const makeProxy = (
    path: ReadonlyArray<string>,
    call: (
      info: ProcedureInfo,
      payload: unknown,
      options: PromiseCallOptions | undefined,
    ) => unknown,
  ): object =>
    new Proxy(() => undefined, {
      get: (_target, key) => {
        if (typeof key === 'symbol' || reservedKeys.has(key)) return undefined;
        return makeProxy([...path, key], call);
      },
      apply: (_target, _thisArg, args: ReadonlyArray<unknown>) =>
        call(lookup(path), args[0], args[1] as PromiseCallOptions | undefined),
    });

  const dispose = (): Promise<void> => {
    disposed ??= runtime.dispose();
    return disposed;
  };
  const effectRoot = makeProxy([], callEffect);
  const promiseRoot = makeProxy([], callPromise);
  const root = new Proxy(
    {},
    {
      get: (_target, key) => {
        switch (key) {
          case '$promise':
            return promiseRoot;
          case '$router':
            return router;
          case 'dispose':
          case Symbol.asyncDispose:
            return dispose;
          default:
            return Reflect.get(effectRoot, key);
        }
      },
    },
  );
  return root as Caller<R>;
};

const abortEffect = (signal: AbortSignal): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    if (signal.aborted) {
      resume(Effect.void);
      return Effect.void;
    }
    const onAbort = () => resume(Effect.void);
    signal.addEventListener('abort', onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener('abort', onAbort));
  });
