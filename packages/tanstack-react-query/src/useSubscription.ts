/**
 * The `useSubscription` React hook for subscription procedures.
 *
 * It is the effect-trpc counterpart of tRPC's `useSubscription`: it takes the result of
 * `rpc.<subscription>.subscriptionOptions(...)`, subscribes while the component is mounted,
 * restarts when the input changes and exposes a status union (`idle` / `connecting` / `pending` /
 * `error`) with the last element as `data`. Only fields the component reads trigger re-renders.
 *
 * @since 0.1.0
 */
import { hashKey } from '@tanstack/react-query';
import * as React from 'react';
import type { FeatureFlags } from './internals/types.js';
import type { RpcSubscriptionOptionsOut } from './subscriptionOptions.js';

/**
 * The status of a subscription: `idle` (disabled), `connecting`, `pending` (live), `error`.
 *
 * @category models
 * @since 0.1.0
 */
export type RpcSubscriptionStatus = 'idle' | 'connecting' | 'pending' | 'error';

/**
 * Fields shared by every {@link RpcSubscriptionResult}.
 *
 * @category models
 * @since 0.1.0
 */
export interface RpcSubscriptionBaseResult<TOutput, TError> {
  readonly status: RpcSubscriptionStatus;
  /** The last element received. */
  readonly data: undefined | TOutput;
  readonly error: null | TError;
  /** Restarts the subscription (clearing data and error). */
  reset: () => void;
}

/**
 * The subscription is disabled (`enabled: false` or `skipToken`).
 *
 * @category models
 * @since 0.1.0
 */
export interface RpcSubscriptionIdleResult<TOutput> extends RpcSubscriptionBaseResult<
  TOutput,
  null
> {
  readonly status: 'idle';
  readonly data: undefined;
  readonly error: null;
}

/**
 * The subscription is being set up; `error` is `null` (links do not reconnect).
 *
 * @category models
 * @since 0.1.0
 */
export interface RpcSubscriptionConnectingResult<TOutput, TError> extends RpcSubscriptionBaseResult<
  TOutput,
  TError
> {
  readonly status: 'connecting';
  readonly data: undefined | TOutput;
  readonly error: TError | null;
}

/**
 * The subscription is live; `data` is the last element (`undefined` before the first one).
 *
 * @category models
 * @since 0.1.0
 */
export interface RpcSubscriptionPendingResult<TOutput> extends RpcSubscriptionBaseResult<
  TOutput,
  undefined
> {
  readonly status: 'pending';
  readonly data: TOutput | undefined;
  readonly error: null;
}

/**
 * The stream failed; `error` is the `ClientError<E>` and `data` keeps the last element.
 *
 * @category models
 * @since 0.1.0
 */
export interface RpcSubscriptionErrorResult<TOutput, TError> extends RpcSubscriptionBaseResult<
  TOutput,
  TError
> {
  readonly status: 'error';
  readonly data: TOutput | undefined;
  readonly error: TError;
}

/**
 * The result of {@link useSubscription} (tRPC's `TRPCSubscriptionResult`): a union discriminated
 * by `status`.
 *
 * **Details**
 *
 * - Narrow on `status === 'error'` to get a non-null `error` (`ClientError<E>`).
 * - A completed stream stays `pending` with its last element; use `onComplete` to react to the
 *   end.
 *
 * @category models
 * @since 0.1.0
 */
export type RpcSubscriptionResult<TOutput, TError> =
  | RpcSubscriptionIdleResult<TOutput>
  | RpcSubscriptionConnectingResult<TOutput, TError>
  | RpcSubscriptionErrorResult<TOutput, TError>
  | RpcSubscriptionPendingResult<TOutput>;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * A proxy over the latest result that records which fields the component reads, so that updates
 * of unread fields do not re-render.
 */
const trackResult = <T extends object>(
  result: React.RefObject<T>,
  onTrackResult: (key: keyof T) => void,
): T =>
  new Proxy(result.current, {
    get: (_target, prop) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the consumer reads the fields of `T` (a property it does not declare reads `undefined`)
      const key = prop as keyof T;
      onTrackResult(key);
      // Bypass the target, so that we always read the latest value.
      return result.current[key];
    },
  });

/**
 * Subscribes to a subscription procedure while the component is mounted (tRPC's
 * `useSubscription`).
 *
 * **When to use**
 *
 * Use in React components to consume `rpc.<subscription>.subscriptionOptions(...)`. Outside React,
 * call `subscriptionOptions(...).subscribe(...)` directly.
 *
 * **Details**
 *
 * - Re-subscribes when the input (query key) or the client changes or `enabled` flips, aborting
 *   the previous subscription; unsubscribes on unmount. Aborting interrupts the server stream.
 * - `skipToken` / `enabled: false` keep it `idle`.
 * - Status goes `connecting` → `pending` (the request was handed to the transport) and stays
 *   `pending` while elements arrive and after the stream completes; `error` on failure.
 * - `reset()` stops the subscription, clears `data` / `error` and starts it again.
 * - Callbacks (`onData`, `onError`, ...) are read from the latest render, so inline functions do
 *   not restart the subscription.
 * - The result is tracked: a component re-renders only when a field it read changes.
 *
 * **Gotchas**
 *
 * - There is no `connecting` state after an error and no automatic reconnect (tRPC's `wsLink`
 *   reconnects); call `reset()` to retry.
 * - The hook is exported from this package (`@rpc-effect/tanstack-react-query`), not from
 *   `@tanstack/react-query`, and takes the options object, not the procedure.
 *
 * **Example** (Live countdown with a typed stream error)
 *
 * ```tsx
 * import { Router, subscription } from '@rpc-effect/core';
 * import type { RpcOptionsProxy } from '@rpc-effect/tanstack-react-query';
 * import { skipToken, useSubscription } from '@rpc-effect/tanstack-react-query';
 * import { Schema } from 'effect';
 *
 * class Cancelled extends Schema.TaggedError<Cancelled>()('Cancelled', { at: Schema.Number }) {}
 * const appRouter = Router.make({
 *   countdown: subscription({
 *     payload: { from: Schema.Number },
 *     success: Schema.Number,
 *     error: Cancelled,
 *   }),
 * });
 * declare const useRpc: () => RpcOptionsProxy<typeof appRouter>;
 *
 * export function Countdown({ from }: { from: number | undefined }) {
 *   const rpc = useRpc();
 *   const sub = useSubscription(
 *     rpc.countdown.subscriptionOptions(from === undefined ? skipToken : { from }, {
 *       onData: (n) => console.log('tick', n),
 *     }),
 *   );
 *   switch (sub.status) {
 *     case 'idle':
 *       return <p>Pick a start value</p>;
 *     case 'connecting':
 *       return <p>Connecting…</p>;
 *     case 'error':
 *       return (
 *         <p>
 *           {sub.error._tag === 'Cancelled' ? `Cancelled at ${sub.error.at}` : sub.error.message}
 *           <button onClick={sub.reset}>retry</button>
 *         </p>
 *       );
 *     case 'pending':
 *       return <p>{sub.data ?? '…'}</p>;
 *   }
 * }
 * ```
 *
 * @see RpcSubscriptionOptions
 * @see {@link RpcSubscriptionResult}
 * @category hooks
 * @since 0.1.0
 */
export const useSubscription = <TOutput, TError>(
  opts: RpcSubscriptionOptionsOut<TOutput, TError, FeatureFlags>,
): RpcSubscriptionResult<TOutput, TError> => {
  type $Result = RpcSubscriptionResult<TOutput, TError>;

  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  const trackedProps = React.useRef(new Set<keyof $Result>());
  const addTrackedProp = React.useCallback((key: keyof $Result) => {
    trackedProps.current.add(key);
  }, []);

  const currentSubscriptionRef = React.useRef<() => void>(() => {});
  const resultRef = React.useRef<$Result | null>(null);
  const queryHash = hashKey(opts.queryKey);
  const { enabled, client } = opts;

  const updateStateRef = React.useRef<(update: (prev: $Result) => $Result) => void>(() => {});

  const reset = React.useCallback((): void => {
    // Stop the previous subscription.
    currentSubscriptionRef.current();
    currentSubscriptionRef.current = () => {};
    const updateState = updateStateRef.current;
    updateState(() => initialState(enabled, reset));
    if (!enabled) return;
    const unsubscribe = optsRef.current.subscribe({
      onStarted: () => {
        optsRef.current.onStarted?.();
        updateState((prev) => ({ ...prev, status: 'pending', error: null }));
      },
      onData: (data) => {
        optsRef.current.onData?.(data);
        updateState((prev) => ({ ...prev, status: 'pending', data, error: null }));
      },
      onError: (error) => {
        optsRef.current.onError?.(error);
        updateState((prev) => ({ ...prev, status: 'error', error }));
      },
      onComplete: () => {
        optsRef.current.onComplete?.();
      },
      onConnectionStateChange: (state) => {
        optsRef.current.onConnectionStateChange?.(state);
        updateState((prev) => {
          switch (state.state) {
            case 'connecting':
              return { ...prev, status: 'connecting', error: state.error };
            case 'idle':
              return { ...prev, status: 'idle', data: undefined, error: null };
            case 'pending':
              // Handled by `onStarted`.
              return prev;
            default:
              return state.state satisfies never;
          }
        });
      },
    });
    currentSubscriptionRef.current = unsubscribe;
    // `queryHash` identifies the input and `client` the transport: a new one restarts the
    // subscription. Callbacks are read from `optsRef`, so new inline functions do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryHash, enabled, client]);

  if (resultRef.current === null) resultRef.current = initialState(enabled, reset);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `current` was set just above and is never reset to `null`
  const latest = resultRef as React.RefObject<$Result>;

  const [state, setState] = React.useState<$Result>(() => trackResult(latest, addTrackedProp));

  updateStateRef.current = (update) => {
    const prev = latest.current;
    const next = update(prev);
    latest.current = next;
    let shouldUpdate = false;
    for (const key of trackedProps.current) {
      if (prev[key] !== next[key]) {
        shouldUpdate = true;
        break;
      }
    }
    if (shouldUpdate) setState(trackResult(latest, addTrackedProp));
  };

  // `reset` changes with the input / `enabled`: expose the current one.
  (latest.current as Mutable<$Result>).reset = reset;

  React.useEffect(() => {
    if (!enabled) {
      // Disabled: drop any previous state (e.g. after `enabled` flipped to false).
      updateStateRef.current(() => initialState(false, reset));
      return undefined;
    }
    reset();
    return () => {
      currentSubscriptionRef.current();
      currentSubscriptionRef.current = () => {};
    };
  }, [reset, enabled]);

  return state;
};

const initialState = <TOutput, TError>(
  enabled: boolean,
  reset: () => void,
): RpcSubscriptionResult<TOutput, TError> =>
  enabled
    ? { status: 'connecting', data: undefined, error: null, reset }
    : { status: 'idle', data: undefined, error: null, reset };
