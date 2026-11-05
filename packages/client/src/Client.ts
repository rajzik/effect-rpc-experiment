/**
 * Creates typed clients for `@effect-trpc/core` routers: a tRPC-style Promise client and an
 * Effect client (`client.$effect`).
 *
 * `createClient(router, { link })` returns a proxy mirroring the router record. Each call is
 * routed by the procedure's tag through the link's `effect/rpc` `RpcClient`; results are
 * decoded with the procedure's schemas, so `Schema.Class` values arrive as instances. Promise
 * calls reject with `ClientError<E>` (from `@effect-trpc/core`); Effect calls fail with
 * `E | RpcTransportError`. `@effect-trpc/tanstack-react-query` builds its query options on top of
 * this client.
 *
 * @since 0.1.0
 */
import {
  causeToClientError,
  isRpcClientError,
  Router,
  RpcInterrupted,
  RpcTransportError,
} from '@effect-trpc/core';
import type {
  ClientError,
  inferError,
  inferOutput,
  ProcedureDef,
  ProcedureInfo,
} from '@effect-trpc/core';
import { Context, Effect, Exit, Layer, ManagedRuntime, Option, Stream } from 'effect';
import type { Schema, Scope } from 'effect';
import { Headers } from 'effect/http';
import type { Rpc, RpcGroup } from 'effect/rpc';
import type { HeadersOption, Link } from './Link.js';

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

/**
 * Options of a Promise-client call (`client.post.byId(input, options)`).
 *
 * **Example** (Aborting a call and sending a trace header)
 *
 * ```ts
 * import type { ProcedureCallOptions } from '@effect-trpc/client';
 *
 * const controller = new AbortController();
 * const options: ProcedureCallOptions = {
 *   signal: controller.signal, // abort() rejects the call with RpcInterrupted
 *   headers: { 'x-trace': 'abc' },
 * };
 * ```
 *
 * @see {@link EffectCallOptions}
 * @category options
 * @since 0.1.0
 */
export interface ProcedureCallOptions {
  /**
   * Aborting interrupts the call (and, through the transport, the server handler): the Promise
   * rejects with `RpcInterrupted`; an async iterable throws `RpcInterrupted` from `next()`.
   */
  readonly signal?: AbortSignal | undefined;
  /** Headers for this call only; merged over the client's headers. */
  readonly headers?: Headers.Input | undefined;
}

/**
 * Options of an Effect-client call (`client.$effect.post.byId(input, options)`). There is no
 * `signal`: interrupt the fiber to cancel.
 *
 * @see {@link ProcedureCallOptions}
 * @category options
 * @since 0.1.0
 */
export interface EffectCallOptions {
  /** Headers for this call only; merged over the client's headers. */
  readonly headers?: Headers.Input | undefined;
}

type PayloadOf<D> =
  D extends ProcedureDef<infer _K, infer P, infer _S, infer _E, infer _M, infer _Rq> ? P : never;

/**
 * The input a client accepts for a procedure: the payload schema's constructor input (for a
 * `Schema.Struct` payload, the plain fields object). `void` when the procedure takes no input.
 *
 * @see {@link Client.Input}
 * @category type-level
 * @since 0.1.0
 */
export type inferClientInput<D extends ProcedureDef.Any> =
  PayloadOf<D> extends Schema.Top ? PayloadOf<D>['~type.make.in'] : never;

/**
 * The rejection type of a Promise-client call: `ClientError<inferError<D>>`, i.e. the
 * procedure's errors or `RpcDefect` / `RpcTransportError` / `RpcInterrupted`.
 *
 * **Example** (Narrowing a rejection by `_tag`)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import type { inferClientError } from '@effect-trpc/client';
 *
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, error: PostNotFound }) },
 * });
 *
 * declare const cause: unknown; // from a `catch` block
 * const error = cause as inferClientError<typeof appRouter.record.post.byId>;
 * if (error._tag === 'PostNotFound') console.log(error.id);
 * ```
 *
 * @see {@link Client.Error}
 * @category type-level
 * @since 0.1.0
 */
export type inferClientError<D extends ProcedureDef.Any> = ClientError<inferError<D>>;

/**
 * The error channel of an Effect-client call: the procedure's errors plus `RpcTransportError`.
 * Defects and interruption are not in it; they stay in the `Cause`.
 *
 * @category type-level
 * @since 0.1.0
 */
export type inferEffectClientError<D extends ProcedureDef.Any> = inferError<D> | RpcTransportError;

/**
 * The call arguments: the input is optional when the procedure takes no input (`void`), so
 * `client.health()` and `client.health(undefined, { signal })` both type-check.
 *
 * @category type-level
 * @since 0.1.0
 */
export type CallArgs<Input, Options> = undefined extends Input
  ? [input?: Input, options?: Options]
  : [input: Input, options?: Options];

/**
 * A Promise-client procedure. Queries and mutations return a `Promise` that rejects with a
 * `ClientError<E>` instance (see {@link inferClientError}); subscriptions return an
 * `AsyncIterable` that throws one.
 *
 * **Details**
 *
 * - Breaking out of a `for await` loop ends the subscription on the server.
 * - Aborting `signal` rejects with `RpcInterrupted` (an iterator's `next()` throws it) and
 *   interrupts the server handler.
 *
 * @see {@link EffectProcedure}
 * @category type-level
 * @since 0.1.0
 */
export type PromiseProcedure<D extends ProcedureDef.Any> = D['kind'] extends 'subscription'
  ? (...args: CallArgs<inferClientInput<D>, ProcedureCallOptions>) => AsyncIterable<inferOutput<D>>
  : (...args: CallArgs<inferClientInput<D>, ProcedureCallOptions>) => Promise<inferOutput<D>>;

/**
 * An Effect-client procedure: an `Effect` (or a `Stream` for subscriptions) with no environment
 * requirement, failing with the procedure's errors or `RpcTransportError`. Server defects are
 * defects (`Effect.die`) and cancellation is interruption, as usual in Effect.
 *
 * **Details**
 *
 * - The returned Effect is lazy: it can be built once and run many times; each run is a call.
 *
 * @see {@link PromiseProcedure}
 * @category type-level
 * @since 0.1.0
 */
export type EffectProcedure<D extends ProcedureDef.Any> = D['kind'] extends 'subscription'
  ? (
      ...args: CallArgs<inferClientInput<D>, EffectCallOptions>
    ) => Stream.Stream<inferOutput<D>, inferEffectClientError<D>>
  : (
      ...args: CallArgs<inferClientInput<D>, EffectCallOptions>
    ) => Effect.Effect<inferOutput<D>, inferEffectClientError<D>>;

type RecordOf<R> = R extends Router<infer Rec> ? Rec : R;

type PromiseRecord<Rec> = {
  readonly [K in keyof Rec]: Rec[K] extends ProcedureDef.Any
    ? PromiseProcedure<Rec[K]>
    : PromiseRecord<RecordOf<Rec[K]>>;
};

type EffectRecord<Rec> = {
  readonly [K in keyof Rec]: Rec[K] extends ProcedureDef.Any
    ? EffectProcedure<Rec[K]>
    : EffectRecord<RecordOf<Rec[K]>>;
};

/**
 * Root keys of a {@link Client} that a router cannot use at its top level. `createClient`
 * throws for a router that does.
 *
 * @category type-level
 * @since 0.1.0
 */
export type ReservedClientKey = '$effect' | '$router' | 'dispose' | 'withHeaders';

const reservedClientKeys: ReadonlySet<string> = new Set<ReservedClientKey>([
  '$effect',
  '$router',
  'dispose',
  'withHeaders',
]);

/**
 * The Effect client of a router: `client.$effect.post.byId(input)`.
 *
 * @see {@link EffectProcedure}
 * @category models
 * @since 0.1.0
 */
export type EffectClient<R extends Router.Any> = EffectRecord<Router.Record<R>>;

/**
 * The methods every {@link Client} has besides the procedures.
 *
 * @category models
 * @since 0.1.0
 */
export interface ClientMethods<R extends Router.Any> {
  /** The same procedures as `Effect`s / `Stream`s (no environment requirement). */
  readonly $effect: EffectClient<R>;
  /** The router this client was created from. */
  readonly $router: R;
  /**
   * Interrupts in-flight calls, closes the link (connections, sockets, in-process servers) and
   * makes later calls fail with `RpcTransportError`. Idempotent. Shared with every client
   * derived through `withHeaders`.
   */
  readonly dispose: () => Promise<void>;
  /** A client sharing this client's connection whose calls also send `headers`. */
  readonly withHeaders: (headers: HeadersOption) => Client<R>;
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}

/**
 * A Promise client mirroring a router: `client.post.byId(input, { signal, headers })`, plus
 * {@link ClientMethods} (`$effect`, `$router`, `withHeaders`, `dispose`).
 *
 * **Details**
 *
 * - The client is not thenable and its proxies are stable (`client.post.byId ===
 *   client.post.byId`), so it is safe to return from async functions and to use in React deps.
 * - Calling a path that is not a procedure throws an `Error` naming the known procedures.
 *
 * @see {@link createClient}
 * @category models
 * @since 0.1.0
 */
export type Client<R extends Router.Any> = {
  readonly [
    K in keyof Router.Record<R> as K extends ReservedClientKey ? never : K
  ]: Router.Record<R>[K] extends ProcedureDef.Any
    ? PromiseProcedure<Router.Record<R>[K]>
    : PromiseRecord<RecordOf<Router.Record<R>[K]>>;
} & ClientMethods<R>;

/**
 * Type-level helpers of {@link Client}, keyed by router or procedure definition
 * (`typeof appRouter.record.post.byId`).
 *
 * @category type-level
 * @since 0.1.0
 */
export declare namespace Client {
  /**
   * The Effect client of a router (`client.$effect`).
   *
   * @since 0.1.0
   */
  export type Effect<R extends Router.Any> = EffectClient<R>;
  /**
   * A Promise-client procedure for a procedure definition.
   *
   * @since 0.1.0
   */
  export type Procedure<D extends ProcedureDef.Any> = PromiseProcedure<D>;
  /**
   * The rejection type of a Promise-client call: `ClientError<E>`.
   *
   * @since 0.1.0
   */
  export type Error<D extends ProcedureDef.Any> = inferClientError<D>;
  /**
   * The input of a client call.
   *
   * @since 0.1.0
   */
  export type Input<D extends ProcedureDef.Any> = inferClientInput<D>;
  /**
   * The output of a client call (each element, for subscriptions).
   *
   * @since 0.1.0
   */
  export type Output<D extends ProcedureDef.Any> = inferOutput<D>;
}

type RouterRpcs<R extends Router.Any> = Extract<Router.Rpcs<R>, Rpc.Any>;

/**
 * The `middleware` option: required when the router has `requiredForClient` middleware.
 *
 * @see {@link CreateClientOptions}
 * @category options
 * @since 0.1.0
 */
export type MiddlewareOption<R extends Router.Any> = [Rpc.MiddlewareClient<RouterRpcs<R>>] extends [
  never,
]
  ? {
      /** Client-side middleware layers (`RpcMiddleware.layerClient(...)`). */
      readonly middleware?: Layer.Layer<never, unknown> | undefined;
    }
  : {
      /**
       * Client-side middleware layers (`RpcMiddleware.layerClient(...)`), required because the
       * router uses middleware declared with `requiredForClient: true`.
       */
      readonly middleware: Layer.Layer<Rpc.MiddlewareClient<RouterRpcs<R>>, unknown>;
    };

/**
 * Options of {@link createClient}.
 *
 * **Gotchas**
 *
 * - With `localLink`, the handler layer must implement every procedure and server middleware
 *   of the router, or `link` is a type error.
 *
 * @category options
 * @since 0.1.0
 */
export type CreateClientOptions<R extends Router.Any> = {
  /** The transport: `httpLink`, `wsLink`, `localLink` or a custom `Link`. */
  readonly link: Link<Rpc.ToHandler<RouterRpcs<R>> | Rpc.Middleware<RouterRpcs<R>>>;
  /**
   * Rpc headers sent with every call (a function is evaluated once per call). They reach server
   * handlers and middleware as `headers`, over every link.
   */
  readonly headers?: HeadersOption | undefined;
} & MiddlewareOption<R>;

// ---------------------------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------------------------

type AnyCall = (
  input: unknown,
  options: { readonly headers: Headers.Headers },
) => Effect.Effect<unknown, unknown> | Stream.Stream<unknown, unknown>;

type AnyRpcClient = { readonly [tag: string]: AnyCall | undefined };

const RpcClientService = Context.Service<AnyRpcClient>('@effect-trpc/client/RpcClient');

interface Shared {
  readonly router: Router.Any;
  readonly runtime: ManagedRuntime.ManagedRuntime<AnyRpcClient, never>;
  disposed: boolean;
  disposing: Promise<void> | undefined;
}

const disposedError = (): RpcTransportError =>
  new RpcTransportError({ message: 'The client has been disposed', cause: undefined });

const toTransportError = <E>(error: E): E | RpcTransportError =>
  isRpcClientError(error) ? new RpcTransportError({ message: error.message, cause: error }) : error;

const resolveHeaders = (
  layers: ReadonlyArray<HeadersOption>,
  call: Headers.Input | undefined,
): Effect.Effect<Headers.Headers, RpcTransportError> =>
  Effect.gen(function* () {
    let headers = Headers.empty;
    for (const layer of layers) {
      const input =
        typeof layer === 'function'
          ? yield* Effect.tryPromise({
              try: async () => await layer(),
              catch: (cause) =>
                new RpcTransportError({ message: 'The client headers() function threw', cause }),
            })
          : layer;
      headers = Headers.merge(headers, Headers.fromInput(input));
    }
    return call === undefined ? headers : Headers.merge(headers, Headers.fromInput(call));
  });

/** Gets the cached `RpcClient` (building the link on first use) and the call function. */
const getCall = (shared: Shared, info: ProcedureInfo): Effect.Effect<AnyCall, RpcTransportError> =>
  Effect.suspend(() => {
    if (shared.disposed) return Effect.fail(disposedError());
    return Effect.flatMap(shared.runtime.contextEffect, (context) => {
      const call = Context.get(context, RpcClientService)[info.tag];
      return call === undefined
        ? Effect.die(new Error(`The link's client has no procedure "${info.tag}"`))
        : Effect.succeed(call);
    });
  });

const effectCall = (
  shared: Shared,
  headers: ReadonlyArray<HeadersOption>,
  info: ProcedureInfo,
  input: unknown,
  options: EffectCallOptions | undefined,
): Effect.Effect<unknown, unknown> =>
  Effect.gen(function* () {
    const resolved = yield* resolveHeaders(headers, options?.headers);
    const call = yield* getCall(shared, info);
    return yield* call(input, { headers: resolved }) as Effect.Effect<unknown, unknown>;
  }).pipe(Effect.mapError(toTransportError));

const streamCall = (
  shared: Shared,
  headers: ReadonlyArray<HeadersOption>,
  info: ProcedureInfo,
  input: unknown,
  options: EffectCallOptions | undefined,
): Stream.Stream<unknown, unknown> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const resolved = yield* resolveHeaders(headers, options?.headers);
      const call = yield* getCall(shared, info);
      return call(input, { headers: resolved }) as Stream.Stream<unknown, unknown>;
    }),
  ).pipe(Stream.mapError(toTransportError));

const isAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;

const promiseCall = (
  shared: Shared,
  effect: Effect.Effect<unknown, unknown>,
  signal: AbortSignal | undefined,
): Promise<unknown> => {
  if (shared.disposed) return Promise.reject(disposedError());
  if (isAborted(signal)) return Promise.reject(new RpcInterrupted());
  return shared.runtime
    .runPromiseExit(effect, signal === undefined ? undefined : { signal })
    .then((exit) => {
      if (Exit.isSuccess(exit)) return exit.value;
      throw causeToClientError(exit.cause);
    });
};

const iterableCall = (
  stream: Stream.Stream<unknown, unknown>,
  signal: AbortSignal | undefined,
): AsyncIterable<unknown> => ({
  [Symbol.asyncIterator]: (): AsyncIterator<unknown> => {
    const inner = Stream.toAsyncIterable(
      stream.pipe(Stream.catchCause((cause) => Stream.fail(causeToClientError(cause)))),
    )[Symbol.asyncIterator]();
    const done: IteratorReturnResult<undefined> = { done: true, value: undefined };
    let finished = false;
    const close = async (): Promise<void> => {
      await inner.return?.();
    };
    const onAbort = (): void => {
      void close();
    };
    const finish = (): void => {
      finished = true;
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    return {
      next: async () => {
        if (finished) return done;
        if (isAborted(signal)) {
          finish();
          await close();
          throw new RpcInterrupted();
        }
        let result: IteratorResult<unknown>;
        try {
          result = await inner.next();
        } catch (error) {
          finish();
          throw error;
        }
        // `inner.next()` resolves `done` when an abort closed it while pending.
        if (isAborted(signal)) {
          finish();
          throw new RpcInterrupted();
        }
        if (result.done === true) finish();
        return result;
      },
      return: async () => {
        if (!finished) {
          finish();
          await close();
        }
        return done;
      },
    };
  },
});

const pathKey = (path: ReadonlyArray<string>): string => JSON.stringify(path);

const describeUnknown = (shared: Shared, path: ReadonlyArray<string>): string => {
  const tag = path.join('.');
  if (path.length === 0) return 'The client root is not callable; call a procedure instead';
  if (Router.isPath(shared.router, path)) {
    return `"${tag}" is a router namespace, not a procedure`;
  }
  const known = Array.from(shared.router.procedures.keys());
  const listed = known.slice(0, 20).join(', ') + (known.length > 20 ? ', ...' : '');
  return `Unknown procedure "${tag}". Known procedures: ${listed}`;
};

type Mode = 'promise' | 'effect';

const makeFacade = <R extends Router.Any>(
  shared: Shared,
  headers: ReadonlyArray<HeadersOption>,
): Client<R> => {
  const nodes = new Map<string, unknown>();

  const call = (mode: Mode, path: ReadonlyArray<string>, args: ReadonlyArray<unknown>): unknown => {
    const info = Option.getOrUndefined(Router.getByPath(shared.router, path));
    if (info === undefined) throw new Error(describeUnknown(shared, path));
    const input = args[0];
    const options = args[1] as ProcedureCallOptions | undefined;
    if (info.kind === 'subscription') {
      const stream = streamCall(shared, headers, info, input, options);
      return mode === 'effect' ? stream : iterableCall(stream, options?.signal);
    }
    const effect = effectCall(shared, headers, info, input, options);
    return mode === 'effect' ? effect : promiseCall(shared, effect, options?.signal);
  };

  const child = (mode: Mode, path: ReadonlyArray<string>, key: string | symbol): unknown => {
    const next = Router.childPath(shared.router, path, key);
    return next === undefined ? undefined : node(mode, next);
  };

  const node = (mode: Mode, path: ReadonlyArray<string>): unknown => {
    const key = `${mode}:${pathKey(path)}`;
    let proxy = nodes.get(key);
    if (proxy === undefined) {
      proxy = new Proxy(() => undefined, {
        get: (_target, prop) => child(mode, path, prop),
        apply: (_target, _this, args: ReadonlyArray<unknown>) => call(mode, path, args),
      });
      nodes.set(key, proxy);
    }
    return proxy;
  };

  const effectRoot: unknown = new Proxy(Object.create(null) as object, {
    get: (_target, prop) => child('effect', [], prop),
  });

  const dispose = (): Promise<void> => {
    if (shared.disposing === undefined) {
      shared.disposed = true;
      shared.disposing = shared.runtime.dispose();
    }
    return shared.disposing;
  };

  const methods = {
    $effect: effectRoot,
    $router: shared.router,
    dispose,
    withHeaders: (extra: HeadersOption) => makeFacade<R>(shared, [...headers, extra]),
    [Symbol.asyncDispose]: dispose,
  };

  return new Proxy(Object.create(null) as object, {
    get: (_target, prop) => {
      if (prop === Symbol.asyncDispose) return dispose;
      if (typeof prop === 'string' && reservedClientKeys.has(prop)) {
        return methods[prop as ReservedClientKey];
      }
      return child('promise', [], prop);
    },
  }) as Client<R>;
};

/**
 * Creates a client for a router over a link.
 *
 * **When to use**
 *
 * Use wherever code calls a router: browsers, other servers, tests (`localLink`), SSR. Pass the
 * same router value the server implements; only its schemas and structure are used.
 *
 * **Details**
 *
 * - The link is connected lazily on the first call (once, shared by every call and by
 *   `withHeaders` clients) and kept until `client.dispose()`.
 * - Results are decoded with the procedure's schemas: `Schema.Class` values are instances,
 *   `Schema.Date` fields are `Date`s.
 * - Promise calls reject with `ClientError<E>`: the procedure's `Schema.TaggedError` instance,
 *   `RpcDefect` (the handler died), `RpcTransportError` (network, HTTP status, protocol, disposed
 *   client) or `RpcInterrupted` (aborted).
 * - `client.$effect` calls fail with `E | RpcTransportError` and need no services.
 * - Headers from `createClient({ headers })`, `withHeaders(...)` and the call are merged; the
 *   most specific wins. A headers function runs once per call.
 * - After `dispose()` calls fail with `RpcTransportError`.
 *
 * **Gotchas**
 *
 * - Throws if the router uses a reserved top-level key (`$effect`, `$router`, `dispose`,
 *   `withHeaders`); nest such procedures under another key.
 * - Routers with `requiredForClient` middleware need the `middleware` option
 *   (`RpcMiddleware.layerClient(...)`); it is a type error to omit it.
 *
 * **Example** (Promise and Effect calls over HTTP)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { query, Router, subscription } from '@effect-trpc/core';
 * import { createClient, httpLink, type Client } from '@effect-trpc/client';
 *
 * class Post extends Schema.Class<Post>('Post')({
 *   id: Schema.Number,
 *   title: Schema.String,
 *   createdAt: Schema.Date,
 * }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 *   countdown: subscription({ payload: { from: Schema.Number }, success: Schema.Number }),
 * });
 *
 * const client = createClient(appRouter, { link: httpLink({ url: 'http://localhost:3000/rpc' }) });
 *
 * try {
 *   const post = await client.post.byId({ id: 1 }); // a Post instance
 *   post.createdAt.getFullYear(); // a real Date
 * } catch (cause) {
 *   const error = cause as Client.Error<typeof appRouter.record.post.byId>;
 *   if (error._tag !== 'PostNotFound') throw error; // RpcDefect | RpcTransportError | RpcInterrupted
 * }
 *
 * for await (const n of client.countdown({ from: 3 })) console.log(n); // 3, 2, 1, 0
 *
 * // Effect<string, RpcTransportError>
 * const title = client.$effect.post.byId({ id: 1 }).pipe(
 *   Effect.map((post) => post.title),
 *   Effect.catchTag('PostNotFound', (e) => Effect.succeed(`missing #${e.id}`)),
 * );
 *
 * await client.dispose();
 * ```
 *
 * **Example** (A client with `requiredForClient` middleware)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { Headers } from 'effect/http';
 * import { RpcMiddleware } from 'effect/rpc';
 * import { query, Router } from '@effect-trpc/core';
 * import { createClient, httpLink } from '@effect-trpc/client';
 *
 * class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}
 * class Token extends RpcMiddleware.Service<Token>()('Token', {
 *   error: Unauthorized,
 *   requiredForClient: true,
 * }) {}
 *
 * const appRouter = Router.make({ secret: query({ success: Schema.String }).middleware(Token) });
 *
 * // The client half attaches the token to every request of a procedure using `Token`.
 * const TokenClient = RpcMiddleware.layerClient(Token, ({ request, next }) =>
 *   next({ ...request, headers: Headers.set(request.headers, 'authorization', 'Bearer t0k3n') }),
 * );
 *
 * const client = createClient(appRouter, {
 *   link: httpLink({ url: 'http://localhost:3000/rpc' }),
 *   middleware: TokenClient,
 * });
 * const secret = await client.secret(); // rejects with Unauthorized when the server says so
 * ```
 *
 * @see {@link httpLink}
 * @see {@link localLink}
 * @see {@link Client}
 * @category constructors
 * @since 0.1.0
 */
export const createClient = <R extends Router.Any>(
  router: R,
  options: CreateClientOptions<R>,
): Client<R> => {
  for (const key of Object.keys(router.record)) {
    if (reservedClientKeys.has(key)) {
      throw new Error(
        `createClient: the router's top-level key "${key}" is reserved by the client (${[...reservedClientKeys].join(', ')}); nest it under another key`,
      );
    }
  }
  // `Link<Handlers>` is only a type-level check (done by `CreateClientOptions`).
  const link = options.link as Link;
  const middleware: Layer.Layer<never, unknown> | undefined = options.middleware;
  const makeClient = link.makeClient(
    router.group as RpcGroup.RpcGroup<Rpc.Any>,
  ) as unknown as Effect.Effect<AnyRpcClient, never, Scope.Scope>;
  const clientLayer = Layer.effect(RpcClientService)(makeClient);
  const runtime = ManagedRuntime.make(
    middleware === undefined
      ? clientLayer
      : clientLayer.pipe(Layer.provide(Layer.orDie(middleware))),
  );
  const shared: Shared = { router, runtime, disposed: false, disposing: undefined };
  return makeFacade<R>(shared, options.headers === undefined ? [] : [options.headers]);
};
