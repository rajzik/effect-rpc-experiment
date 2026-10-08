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

/** Per-call options of the Effect caller. */
export interface CallOptions {
  /** Request headers, visible to middleware and to handlers (`ctx.headers`). */
  readonly headers?: Headers.Input | undefined;
}

/** Per-call options of the Promise caller. */
export interface PromiseCallOptions extends CallOptions {
  /** Aborting interrupts the handler; the promise rejects with `RpcInterrupted`. */
  readonly signal?: AbortSignal | undefined;
}

type RecordOf<R> = R extends Router<infer Rec> ? Rec : R;

/** Effect-returning call signature of one procedure. */
export type EffectProcedure<D extends ProcedureDef.Any> =
  inferKind<D> extends 'subscription'
    ? (input: inferInput<D>, options?: CallOptions) => Stream.Stream<inferOutput<D>, inferError<D>>
    : (input: inferInput<D>, options?: CallOptions) => Effect.Effect<inferOutput<D>, inferError<D>>;

/**
 * Promise-returning call signature of one procedure. Rejections are `ClientError<E>` instances;
 * subscriptions return an `AsyncIterable` whose iteration throws `ClientError<E>`.
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

/** The Promise half of a {@link Caller}: `caller.$promise.post.byId(input, { signal })`. */
export type PromiseCaller<R extends Router.Any> = PromiseRecord<R['record']>;

/**
 * An in-process typed caller for a router (no serialization; the router's middleware runs).
 *
 * - `caller.post.byId(input, { headers? })` → `Effect<A, E>`; subscriptions → `Stream<A, E>`
 * - `caller.$promise.post.byId(input, { signal?, headers? })` → `Promise<A>` rejecting with
 *   `ClientError<E>`; subscriptions → `AsyncIterable<A>`
 */
export type Caller<R extends Router.Any> = EffectRecord<R['record']> & {
  readonly $promise: PromiseCaller<R>;
  /** The router this caller was created for. */
  readonly $router: R;
  /** Releases the handler layer (its finalizers run). Later calls are interrupted. */
  readonly dispose: () => Promise<void>;
  readonly [Symbol.asyncDispose]: () => Promise<void>;
};

/** Options of {@link createCaller}. */
export interface CallerOptions<R extends Router.Any, LE> {
  /**
   * Layer providing every handler of the router, the server implementation of every middleware
   * it uses and, for middleware marked `requiredForClient`, its client implementation.
   */
  readonly handlers: Layer.Layer<Caller.Requirements<R>, LE>;
}

export declare namespace Caller {
  /** What the handler layer of a caller must provide. */
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
 * handlers through `RpcTest.makeClient` — no HTTP, no serialization — but the router's
 * middleware still runs and per-call headers reach it.
 *
 * ```ts
 * const caller = createCaller(appRouter, { handlers: Layer.mergeAll(HandlersLive, AuthLive) });
 * const post = await caller.$promise.post.byId({ id: 1 }, { headers: { 'x-user': 'ada' } });
 * const program = caller.post.byId({ id: 1 }); // Effect<Post, PostNotFound>
 * await caller.dispose();
 * ```
 *
 * The handler layer is built lazily on the first call and shared by all calls until
 * `dispose()`. Layer construction failures surface as defects (`RpcDefect` for promises).
 * Calling a path that is not a procedure of the router throws an `Error`.
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
