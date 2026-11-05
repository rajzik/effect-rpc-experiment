/**
 * Types and the builder behind `rpc.<subscription>.subscriptionOptions(input, opts)`.
 *
 * Subscriptions are not TanStack queries: the options object carries the callbacks, an `enabled`
 * flag, a key (used by `useSubscription` to detect input changes) and a `subscribe` function that
 * iterates the Promise client's `AsyncIterable` and stops by aborting it, which interrupts the
 * server stream. `useSubscription` consumes it in React; `subscribe` works without React.
 *
 * @since 0.1.0
 */
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
 * The connection state of a subscription (tRPC's `TRPCConnectionState`), reported to
 * `onConnectionStateChange`.
 *
 * **Details**
 *
 * - effect-trpc links do not reconnect, so a subscription goes `connecting` → `pending` and stays
 *   there until it ends; `error` is always `null` here (failures go to `onError`).
 *
 * @category models
 * @since 0.1.0
 */
export interface RpcConnectionState<TError> {
  readonly state: 'idle' | 'connecting' | 'pending';
  readonly error: TError | null;
}

/**
 * Callbacks of a subscription: `onStarted`, `onData`, `onError`, `onComplete`,
 * `onConnectionStateChange`.
 *
 * **Details**
 *
 * - No callback runs after the subscription was stopped (abort, restart or unmount).
 * - `onError` receives `ClientError<E>`; a stream ends after its first error.
 *
 * @category models
 * @since 0.1.0
 */
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
  /** The connection state changed (`connecting`, then `pending`). */
  onConnectionStateChange?: (state: RpcConnectionState<TError>) => void;
}

/**
 * `subscriptionOptions` input options: the callbacks plus `enabled` and `rpc: { headers }`.
 *
 * @see {@link RpcSubscriptionOptions}
 * @category options
 * @since 0.1.0
 */
export interface RpcSubscriptionOptionsIn<TOutput, TError> extends RpcSubscriptionCallbacks<
  TOutput,
  TError
> {
  /** Set to `false` to not subscribe. Defaults to `true` unless the input is `skipToken`. */
  enabled?: boolean;
  /** Request options (headers). */
  rpc?: RpcRequestOptions;
}

/**
 * Options of `subscriptionOptions(...).subscribe`: the callbacks plus an optional `signal` that
 * unsubscribes when aborted.
 *
 * @see {@link RpcSubscriptionOptionsOut}
 * @category options
 * @since 0.1.0
 */
export interface RpcSubscribeOptions<TOutput, TError> extends RpcSubscriptionCallbacks<
  TOutput,
  TError
> {
  readonly signal?: AbortSignal | undefined;
}

/**
 * `subscriptionOptions` result, consumed by `useSubscription` or started manually with
 * `subscribe`.
 *
 * **Details**
 *
 * - `subscribe` ignores the callbacks given to `subscriptionOptions`; pass the callbacks to
 *   `subscribe` itself (`useSubscription` forwards the option callbacks for you).
 *
 * @see {@link RpcSubscriptionOptions}
 * @category options
 * @since 0.1.0
 */
export interface RpcSubscriptionOptionsOut<TOutput, TError, TFeatureFlags extends FeatureFlags>
  extends RpcSubscriptionCallbacks<TOutput, TError>, RpcOptionsResult {
  enabled: boolean;
  queryKey: RpcQueryKey<TFeatureFlags['keyPrefix']>;
  /**
   * The client the subscription runs on (the options proxy's `client`). `useSubscription`
   * re-subscribes when it changes, e.g. when `RpcProvider` gets a new client.
   */
  readonly client: object;
  /**
   * Starts the subscription and returns a function that stops it (aborting the underlying
   * request, which interrupts the server stream).
   */
  subscribe: (innerOpts: RpcSubscribeOptions<TOutput, TError>) => () => void;
}

/**
 * The signature of `rpc.<subscription>.subscriptionOptions(input | skipToken, opts?)`: options for
 * `useSubscription` (tRPC's `TRPCSubscriptionOptions`).
 *
 * **When to use**
 *
 * Use for subscription procedures (server `Stream`s). Pass the result to `useSubscription` in
 * React, or call its `subscribe` outside React.
 *
 * **Details**
 *
 * - `enabled` defaults to `true`, or `false` when the input is `skipToken`.
 * - Elements are decoded with the procedure's success schema (class instances), errors are
 *   `ClientError<E>`.
 * - `subscribe(callbacks)` starts the stream and returns a function that stops it; aborting
 *   `callbacks.signal` stops it too. Stopping interrupts the server stream.
 *
 * **Gotchas**
 *
 * - tRPC's `tracked()` / `lastEventId` and automatic reconnects are not supported.
 * - Subscriptions are not stored in the `QueryClient`; their `queryKey` only identifies the input.
 *
 * **Example** (Subscribing outside React)
 *
 * ```ts
 * import type { Client } from '@effect-trpc/client';
 * import { Router, subscription } from '@effect-trpc/core';
 * import { createRpcOptionsProxy } from '@effect-trpc/tanstack-react-query';
 * import { Schema } from 'effect';
 *
 * const appRouter = Router.make({
 *   countdown: subscription({ payload: { from: Schema.Number }, success: Schema.Number }),
 * });
 * declare const client: Client<typeof appRouter>;
 *
 * const rpc = createRpcOptionsProxy({ client });
 * const controller = new AbortController();
 *
 * rpc.countdown.subscriptionOptions({ from: 3 }).subscribe({
 *   signal: controller.signal, // abort() stops the stream and interrupts the server
 *   onData: (n) => console.log(n),
 *   onError: (error) => console.error(error._tag),
 *   onComplete: () => console.log('done'),
 * });
 * ```
 *
 * @see useSubscription
 * @see DecorateSubscriptionProcedure
 * @category options
 * @since 0.1.0
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
  readonly client: object;
  readonly call: ProcedureCaller;
  readonly path: ReadonlyArray<string>;
  readonly queryKey: RpcQueryKey<boolean>;
  readonly input: unknown;
  readonly opts: RpcSubscriptionOptionsIn<unknown, unknown> | undefined;
}): RpcSubscriptionOptionsOut<unknown, unknown, FeatureFlags> => {
  const { client, call, path, queryKey, input, opts = {} } = args;
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
      let iterator: AsyncIterator<unknown> | undefined;
      let finished = false;
      try {
        const iterable = call(
          path,
          input === skipToken ? undefined : input,
          callOptions(signal, opts.rpc),
        ) as AsyncIterable<unknown>;
        iterator = iterable[Symbol.asyncIterator]();
        let next = iterator.next();
        // Avoid an unhandled rejection if a callback below throws before `next` is awaited.
        next.catch(noop);
        // The first pull hands the request to the transport; report `pending` once it ran.
        await Promise.resolve();
        if (signal.aborted) return;
        inner.onConnectionStateChange?.({ state: 'pending', error: null });
        inner.onStarted?.();
        for (;;) {
          let result: IteratorResult<unknown>;
          try {
            result = await next;
          } catch (error) {
            finished = true; // the stream failed: nothing to close
            throw error;
          }
          if (signal.aborted) return;
          if (result.done === true) {
            finished = true;
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
        // Release the transport on every other exit (abort, a throwing callback): cancel the
        // request and close the iterator, as `for await` would.
        if (!finished) {
          abort();
          void Promise.resolve(iterator?.return?.()).catch(noop);
        }
      }
    };
    void run();
    return abort;
  };

  return {
    ...opts,
    enabled,
    client,
    subscribe,
    queryKey,
    rpc: createRpcOptionsResult(path),
  };
};
