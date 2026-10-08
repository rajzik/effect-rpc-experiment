import { RpcTransportError, type ClientError, type Router } from '@effect-trpc/core';
import { Exit } from 'effect';
import * as React from 'react';
import { decodeActionResultInternal, type EncodedActionResult } from './serverActions.js';
import type { ActionPath } from './types.js';

/** The status of a {@link useServerAction} hook. */
export type ServerActionStatus = 'idle' | 'pending' | 'success' | 'error';

/** Options of {@link useServerAction}: where to find the schemas to decode the result with. */
export interface UseServerActionOptions<R extends Router.Any> {
  /** The router the action was created from (its schemas decode the result). */
  readonly router: R;
  /** The procedure the action calls, e.g. `"post.create"`. */
  readonly path: ActionPath<R>;
}

/** The result of {@link useServerAction} (tRPC's `useAction`). */
export interface UseServerActionResult<Args extends ReadonlyArray<unknown>, A, E> {
  /**
   * Calls the action and decodes its result. Never rejects: resolves with the decoded `Exit`
   * (also reflected in `data` / `error` / `status`).
   */
  readonly run: (...args: Args) => Promise<Exit.Exit<A, ClientError<E>>>;
  readonly status: ServerActionStatus;
  /** The output of the last successful call (class instances). */
  readonly data: A | undefined;
  /** The error of the last failed call: the procedure's `TaggedError` or an infrastructure error. */
  readonly error: ClientError<E> | null;
  readonly isPending: boolean;
  /** Back to `idle`, forgetting `data` and `error`. */
  readonly reset: () => void;
}

interface State<A, E> {
  readonly status: ServerActionStatus;
  readonly data: A | undefined;
  readonly error: ClientError<E> | null;
}

type Outcome<A, E> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: ClientError<E> };

const idle: State<never, never> = { status: 'idle', data: undefined, error: null };

/**
 * Calls a server action created with `createServerActionCaller` from a client component and
 * decodes its result to class instances, with the procedure's error union typed:
 *
 * ```tsx
 * const create = useServerAction(createPost, { router: appRouter, path: 'post.create' });
 * create.error; // ClientError<Forbidden> | null
 * <button onClick={() => void create.run({ title })}>Create</button>
 * ```
 *
 * Only the result of the latest `run` is kept when calls overlap.
 */
export const useServerAction = <Args extends ReadonlyArray<unknown>, A, E, R extends Router.Any>(
  action: (...args: Args) => PromiseLike<EncodedActionResult<A, E>>,
  options: UseServerActionOptions<R>,
): UseServerActionResult<Args, A, E> => {
  const [state, setState] = React.useState<State<A, E>>(idle);
  const latest = React.useRef(0);
  const { router, path } = options;

  const run = React.useCallback(
    async (...args: Args): Promise<Exit.Exit<A, ClientError<E>>> => {
      const id = ++latest.current;
      setState((previous) => ({ ...previous, status: 'pending' }));
      let outcome: Outcome<A, E>;
      try {
        const encoded = await action(...args);
        outcome = decodeActionResultInternal(router, path, encoded) as Outcome<A, E>;
      } catch (cause) {
        outcome = {
          ok: false,
          error: new RpcTransportError({
            message: cause instanceof Error ? cause.message : 'The server action request failed',
            cause,
          }),
        };
      }
      if (id === latest.current) {
        setState(
          outcome.ok
            ? { status: 'success', data: outcome.value, error: null }
            : { status: 'error', data: undefined, error: outcome.error },
        );
      }
      return outcome.ok ? Exit.succeed(outcome.value) : Exit.fail(outcome.error);
    },
    [action, router, path],
  );

  const reset = React.useCallback(() => {
    latest.current++;
    setState(idle);
  }, []);

  return { ...state, run, reset, isPending: state.status === 'pending' };
};
