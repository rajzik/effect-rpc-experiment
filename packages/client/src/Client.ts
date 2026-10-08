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

/** Options of a Promise-client call. */
export interface ProcedureCallOptions {
  /**
   * Aborting interrupts the call (and, through the transport, the server handler): the Promise
   * rejects with `RpcInterrupted`; an async iterable throws `RpcInterrupted` from `next()`.
   */
  readonly signal?: AbortSignal | undefined;
  /** Headers for this call only; merged over the client's headers. */
  readonly headers?: Headers.Input | undefined;
}

/** Options of an Effect-client call. Interrupt the fiber to cancel. */
export interface EffectCallOptions {
  /** Headers for this call only; merged over the client's headers. */
  readonly headers?: Headers.Input | undefined;
}

type PayloadOf<D> =
  D extends ProcedureDef<infer _K, infer P, infer _S, infer _E, infer _M, infer _Rq> ? P : never;

/**
 * The input a client accepts for a procedure: the payload schema's constructor input (for a
 * `Schema.Struct` payload, the plain fields object). `void` when the procedure takes no input.
 */
export type inferClientInput<D extends ProcedureDef.Any> =
  PayloadOf<D> extends Schema.Top ? PayloadOf<D>['~type.make.in'] : never;

/** The rejection type of a Promise-client call: `ClientError<inferError<D>>`. */
export type inferClientError<D extends ProcedureDef.Any> = ClientError<inferError<D>>;

/** The error channel of an Effect-client call: the procedure's errors plus `RpcTransportError`. */
export type inferEffectClientError<D extends ProcedureDef.Any> = inferError<D> | RpcTransportError;

/** The call arguments: the input is optional when the procedure takes no input (`void`). */
export type CallArgs<Input, Options> = undefined extends Input
  ? [input?: Input, options?: Options]
  : [input: Input, options?: Options];

/**
 * A Promise-client procedure. Queries and mutations return a `Promise` that rejects with a
 * `ClientError<E>` instance (see {@link inferClientError}); subscriptions return an
 * `AsyncIterable` that throws one.
 */
export type PromiseProcedure<D extends ProcedureDef.Any> = D['kind'] extends 'subscription'
  ? (...args: CallArgs<inferClientInput<D>, ProcedureCallOptions>) => AsyncIterable<inferOutput<D>>
  : (...args: CallArgs<inferClientInput<D>, ProcedureCallOptions>) => Promise<inferOutput<D>>;

/**
 * An Effect-client procedure: an `Effect` (or a `Stream` for subscriptions) with no environment
 * requirement, failing with the procedure's errors or `RpcTransportError`. Server defects are
 * defects (`Effect.die`) and cancellation is interruption, as usual in Effect.
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

/** Root keys of a {@link Client} that a router cannot use at its top level. */
export type ReservedClientKey = '$effect' | '$router' | 'dispose' | 'withHeaders';

const reservedClientKeys: ReadonlySet<string> = new Set<ReservedClientKey>([
  '$effect',
  '$router',
  'dispose',
  'withHeaders',
]);

/** The Effect client of a router: `client.$effect.post.byId(input)`. */
export type EffectClient<R extends Router.Any> = EffectRecord<Router.Record<R>>;

/** The methods every {@link Client} has besides the procedures. */
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
 * A Promise client mirroring a router: `client.post.byId(input, { signal, headers })`.
 */
export type Client<R extends Router.Any> = {
  readonly [
    K in keyof Router.Record<R> as K extends ReservedClientKey ? never : K
  ]: Router.Record<R>[K] extends ProcedureDef.Any
    ? PromiseProcedure<Router.Record<R>[K]>
    : PromiseRecord<RecordOf<Router.Record<R>[K]>>;
} & ClientMethods<R>;

export declare namespace Client {
  /** The Effect client of a router (`client.$effect`). */
  export type Effect<R extends Router.Any> = EffectClient<R>;
  /** A Promise-client procedure for a procedure definition. */
  export type Procedure<D extends ProcedureDef.Any> = PromiseProcedure<D>;
  /** The rejection type of a Promise-client call. */
  export type Error<D extends ProcedureDef.Any> = inferClientError<D>;
  /** The input of a client call. */
  export type Input<D extends ProcedureDef.Any> = inferClientInput<D>;
  /** The output of a client call (each element, for subscriptions). */
  export type Output<D extends ProcedureDef.Any> = inferOutput<D>;
}

type RouterRpcs<R extends Router.Any> = Extract<Router.Rpcs<R>, Rpc.Any>;

/** The `middleware` option: required when the router has `requiredForClient` middleware. */
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

/** Options of {@link createClient}. */
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
  /** Path prefixes of the router (namespaces and procedures), JSON-encoded. */
  readonly prefixes: ReadonlySet<string>;
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
  if (shared.prefixes.has(pathKey(path))) {
    return `"${tag}" is a router namespace, not a procedure`;
  }
  const known = Array.from(shared.router.procedures.keys());
  const listed = known.slice(0, 20).join(', ') + (known.length > 20 ? ', ...' : '');
  return `Unknown procedure "${tag}". Known procedures: ${listed}`;
};

/**
 * Keys that introspection (await, JSON, test matchers, React, Node inspect) probes on any object.
 * They resolve to `undefined` unless the router actually uses them as a path segment.
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
    if (typeof key !== 'string') return undefined;
    const next = [...path, key];
    if (introspectionKeys.has(key) && !shared.prefixes.has(pathKey(next))) return undefined;
    return node(mode, next);
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
 * ```ts
 * const client = createClient(appRouter, { link: httpLink({ url: 'http://localhost:3000/rpc' }) });
 * const post = await client.post.byId({ id: 1 }); // Post instance
 * const exit = await Effect.runPromiseExit(client.$effect.post.byId({ id: 1 }));
 * ```
 *
 * The link is connected lazily on the first call and kept until `client.dispose()`.
 * Throws if the router uses a reserved top-level key (`$effect`, `$router`, `dispose`,
 * `withHeaders`).
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
  const prefixes = new Set<string>();
  for (const info of router.procedures.values()) {
    for (let i = 1; i <= info.path.length; i++) prefixes.add(pathKey(info.path.slice(0, i)));
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
  const shared: Shared = { router, runtime, prefixes, disposed: false, disposing: undefined };
  return makeFacade<R>(shared, options.headers === undefined ? [] : [options.headers]);
};
