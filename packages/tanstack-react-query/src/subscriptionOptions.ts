import type { SkipToken } from '@tanstack/react-query';
import { skipToken } from '@tanstack/react-query';
import { callOptions, type ProcedureCaller } from './internals/call.js';
import { createRpcOptionsResult } from './internals/keys.js';
import type {
  DefaultFeatureFlags,
  FeatureFlags,
  ResolverDef,
  RpcOptionsResult,
  RpcQueryKey,
  RpcRequestOptions,
} from './internals/types.js';

/**
 * The connection state of a subscription (tRPC's `TRPCConnectionState`). effect-trpc links do not
 * reconnect, so a subscription goes `connecting` → `pending` and stays there until it ends.
 */
export interface RpcConnectionState<TError> {
  readonly state: 'idle' | 'connecting' | 'pending';
  readonly error: TError | null;
}

/** Callbacks of a subscription. */
export interface RpcSubscriptionCallbacks<TOutput, TError> {
  /**
   * The subscription request has been handed to the transport (status `pending`). Called once,
   * before the first element.
   */
  onStarted?: () => void;
  /** An element arrived. */
  onData?: (data: TOutput) => void;
  /** The stream failed with a `ClientError<E>` (a typed error, `RpcDefect`, ...). */
  onError?: (error: TError) => void;
  /** The server completed the stream. */
  onComplete?: () => void;
  onConnectionStateChange?: (state: RpcConnectionState<TError>) => void;
}

/** `subscriptionOptions` input options. */
export interface RpcSubscriptionOptionsIn<TOutput, TError> extends RpcSubscriptionCallbacks<
  TOutput,
  TError
> {
  /** Set to `false` to not subscribe. Defaults to `true` unless the input is `skipToken`. */
  enabled?: boolean;
  /** Request options (headers). */
  rpc?: RpcRequestOptions;
}

/** Options of `subscribe`: the callbacks plus an optional signal that unsubscribes. */
export interface RpcSubscribeOptions<TOutput, TError> extends RpcSubscriptionCallbacks<
  TOutput,
  TError
> {
  readonly signal?: AbortSignal | undefined;
}

/** `subscriptionOptions` result, consumed by {@link useSubscription}. */
export interface RpcSubscriptionOptionsOut<TOutput, TError, TFeatureFlags extends FeatureFlags>
  extends RpcSubscriptionCallbacks<TOutput, TError>, RpcOptionsResult {
  enabled: boolean;
  queryKey: RpcQueryKey<TFeatureFlags['keyPrefix']>;
  /**
   * Starts the subscription and returns a function that stops it (aborting the underlying
   * request, which interrupts the server stream).
   */
  subscribe: (innerOpts: RpcSubscribeOptions<TOutput, TError>) => () => void;
}

/**
 * `rpc.<subscription>.subscriptionOptions(input | skipToken, opts?)`: options for
 * {@link useSubscription} (tRPC's `TRPCSubscriptionOptions`).
 */
export interface RpcSubscriptionOptions<
  TDef extends ResolverDef,
  TFeatureFlags extends FeatureFlags = DefaultFeatureFlags,
> {
  (
    input: TDef['input'] | SkipToken,
    opts?: RpcSubscriptionOptionsIn<TDef['output'], TDef['error']>,
  ): RpcSubscriptionOptionsOut<TDef['output'], TDef['error'], TFeatureFlags>;
}

const noop = (): void => {};

/** @internal Builds the options of `subscriptionOptions`. */
export const rpcSubscriptionOptions = (args: {
  readonly call: ProcedureCaller;
  readonly path: ReadonlyArray<string>;
  readonly queryKey: RpcQueryKey<boolean>;
  readonly input: unknown;
  readonly opts: RpcSubscriptionOptionsIn<unknown, unknown> | undefined;
}): RpcSubscriptionOptionsOut<unknown, unknown, FeatureFlags> => {
  const { call, path, queryKey, input, opts = {} } = args;
  const enabled = opts.enabled === undefined ? input !== skipToken : opts.enabled;

  const subscribe = (inner: RpcSubscribeOptions<unknown, unknown>): (() => void) => {
    const controller = new AbortController();
    const { signal } = controller;
    const abort = (): void => controller.abort();
    if (inner.signal?.aborted === true) abort();
    inner.signal?.addEventListener('abort', abort, { once: true });

    const run = async (): Promise<void> => {
      if (signal.aborted) return;
      inner.onConnectionStateChange?.({ state: 'connecting', error: null });
      try {
        const iterable = call(
          path,
          input === skipToken ? undefined : input,
          callOptions(signal, opts.rpc),
        ) as AsyncIterable<unknown>;
        const iterator = iterable[Symbol.asyncIterator]();
        let next = iterator.next();
        // Avoid an unhandled rejection if a callback below throws before `next` is awaited.
        next.catch(noop);
        // The first pull hands the request to the transport; report `pending` once it ran.
        await Promise.resolve();
        if (signal.aborted) return;
        inner.onConnectionStateChange?.({ state: 'pending', error: null });
        inner.onStarted?.();
        for (;;) {
          const result = await next;
          if (signal.aborted) return;
          if (result.done === true) {
            inner.onComplete?.();
            return;
          }
          inner.onData?.(result.value);
          next = iterator.next();
          next.catch(noop);
        }
      } catch (error) {
        if (!signal.aborted) inner.onError?.(error);
      } finally {
        inner.signal?.removeEventListener('abort', abort);
      }
    };
    void run();
    return abort;
  };

  return {
    ...opts,
    enabled,
    subscribe,
    queryKey,
    rpc: createRpcOptionsResult(path),
  };
};
