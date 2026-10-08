import { hashKey } from '@tanstack/react-query';
import * as React from 'react';
import type { FeatureFlags } from './internals/types.js';
import type { RpcSubscriptionOptionsOut } from './subscriptionOptions.js';

/** The status of a subscription: `idle` (disabled), `connecting`, `pending` (live), `error`. */
export type RpcSubscriptionStatus = 'idle' | 'connecting' | 'pending' | 'error';

/** Fields shared by every {@link RpcSubscriptionResult}. */
export interface RpcSubscriptionBaseResult<TOutput, TError> {
  readonly status: RpcSubscriptionStatus;
  /** The last element received. */
  readonly data: undefined | TOutput;
  readonly error: null | TError;
  /** Restarts the subscription (clearing data and error). */
  reset: () => void;
}

/** The subscription is disabled (`enabled: false` or `skipToken`). */
export interface RpcSubscriptionIdleResult<TOutput> extends RpcSubscriptionBaseResult<
  TOutput,
  null
> {
  readonly status: 'idle';
  readonly data: undefined;
  readonly error: null;
}

/** The subscription is being set up. */
export interface RpcSubscriptionConnectingResult<TOutput, TError> extends RpcSubscriptionBaseResult<
  TOutput,
  TError
> {
  readonly status: 'connecting';
  readonly data: undefined | TOutput;
  readonly error: TError | null;
}

/** The subscription is live; `data` is the last element. */
export interface RpcSubscriptionPendingResult<TOutput> extends RpcSubscriptionBaseResult<
  TOutput,
  undefined
> {
  readonly status: 'pending';
  readonly data: TOutput | undefined;
  readonly error: null;
}

/** The stream failed; `error` is the `ClientError<E>`. */
export interface RpcSubscriptionErrorResult<TOutput, TError> extends RpcSubscriptionBaseResult<
  TOutput,
  TError
> {
  readonly status: 'error';
  readonly data: TOutput | undefined;
  readonly error: TError;
}

/** The result of {@link useSubscription} (tRPC's `TRPCSubscriptionResult`). */
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
      onTrackResult(prop as keyof T);
      // Bypass the target, so that we always read the latest value.
      return result.current[prop as keyof T];
    },
  });

/**
 * Subscribes to a subscription procedure while the component is mounted (tRPC's
 * `useSubscription`):
 *
 * ```tsx
 * const sub = useSubscription(rpc.post.onCreated.subscriptionOptions(undefined, { onData }));
 * sub.status; // 'idle' | 'connecting' | 'pending' | 'error'
 * ```
 *
 * Re-subscribes when the input (query key) changes or `enabled` flips, aborting the previous
 * subscription; unsubscribes on unmount. `skipToken` / `enabled: false` keep it `idle`.
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
  const { enabled } = opts;

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
          }
        });
      },
    });
    currentSubscriptionRef.current = unsubscribe;
    // `queryHash` identifies the input: a new input restarts the subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryHash, enabled]);

  if (resultRef.current === null) resultRef.current = initialState(enabled, reset);
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
      return;
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
