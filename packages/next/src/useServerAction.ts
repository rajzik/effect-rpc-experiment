/**
 * A React hook that calls an effect-trpc server action from a client component (tRPC's
 * `useAction`).
 *
 * Actions created with `createServerActionCaller` resolve with an encoded `Exit`;
 * {@link useServerAction} decodes it with the router's schemas into class instances and a typed
 * `ClientError<E>` (`E | RpcDefect | RpcTransportError | RpcInterrupted`), and tracks
 * `status` / `data` / `error`. Client code.
 *
 * @since 0.1.0
 */
import { RpcTransportError, type ClientError, type Router } from '@effect-trpc/core';
import { Exit } from 'effect';
import * as React from 'react';
import { decodeActionResultInternal, type EncodedActionResult } from './serverActions.js';
import type { ActionPath, ErrorAt, OutputAt } from './types.js';

/**
 * The status of a {@link useServerAction} hook.
 *
 * @category models
 * @since 0.1.0
 */
export type ServerActionStatus = 'idle' | 'pending' | 'success' | 'error';

/**
 * Options of {@link useServerAction}: where to find the schemas to decode the result with. Both
 * fields are required.
 *
 * @see {@link useServerAction}
 * @category options
 * @since 0.1.0
 */
export interface UseServerActionOptions<
  R extends Router.Any,
  P extends ActionPath<R> = ActionPath<R>,
> {
  /** The router the action was created from (its schemas decode the result). */
  readonly router: R;
  /**
   * The procedure the action calls, e.g. `"post.create"`. `useServerAction` rejects a path whose
   * output or error type differs from the action's, so the result is decoded with its schemas.
   */
  readonly path: P;
}

/**
 * Type-level guard of {@link useServerAction}: `{}` when the procedure at `P` has the action's
 * output `A` and error `E`, otherwise a `path` that no string is assignable to.
 *
 * @internal
 */
export type CheckActionPath<R extends Router.Any, P extends string, A, E> = [
  OutputAt<R, P>,
  ErrorAt<R, P>,
] extends [A, E]
  ? [A, E] extends [OutputAt<R, P>, ErrorAt<R, P>]
    ? unknown
    : { readonly path: `the action's result type does not match path "${P}"` }
  : { readonly path: `the action's result type does not match path "${P}"` };

/**
 * The result of {@link useServerAction} (tRPC's `useAction`).
 *
 * @see {@link useServerAction}
 * @category models
 * @since 0.1.0
 */
export interface UseServerActionResult<Args extends ReadonlyArray<unknown>, A, E> {
  /**
   * Calls the action and decodes its result. Never rejects: resolves with the decoded `Exit`
   * (also reflected in `data` / `error` / `status`).
   */
  readonly run: (...args: Args) => Promise<Exit.Exit<A, ClientError<E>>>;
  /** `idle` → `pending` → `success` | `error`. */
  readonly status: ServerActionStatus;
  /** The output of the last successful call (class instances). */
  readonly data: A | undefined;
  /** The error of the last failed call: the procedure's `TaggedError` or an infrastructure error. */
  readonly error: ClientError<E> | null;
  /** `status === 'pending'`. */
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
 * decodes its result to class instances, with the procedure's error union typed.
 *
 * **When to use**
 *
 * Use it in `'use client'` components that trigger a server action (forms, buttons) and need
 * pending state and typed errors. Prefer `unwrapActionResult` inside a TanStack `useMutation`
 * when you want mutation caching / callbacks, and `useRpc().x.mutationOptions()` when the call
 * should go through the route handler instead of a server action.
 *
 * **Details**
 *
 * - `run(...args)` never rejects: it resolves with the decoded `Exit<A, ClientError<E>>` and
 *   also updates `status`, `data` and `error`.
 * - `error` is `ClientError<E> | null`, so `error._tag` narrows to the procedure's errors or to
 *   `RpcDefect` / `RpcTransportError` (the action request itself failed) / `RpcInterrupted`.
 * - While pending, the previous `data` / `error` stay visible; a failure clears `data`.
 * - When calls overlap only the latest `run` updates the state; `reset()` returns to `idle` and
 *   ignores in-flight calls.
 *
 * **Gotchas**
 *
 * - `router` is the router **value**: importing it ships the schemas to the browser. Import it
 *   from the schemas-only module, never from a module that imports handlers.
 * - `path` must name the procedure the action calls. It is not inferred from `action`, but a
 *   path whose output or error type differs from the action's is a type error.
 * - Import the action from the `'use server'` module; do not import `createServerActionCaller`
 *   or handlers into the client component.
 *
 * **Example** (app/new-post.tsx, a client component with typed errors)
 *
 * ```tsx
 * // app/new-post.tsx — client code
 * 'use client';
 * import { mutation, Router } from '@effect-trpc/core';
 * import { useServerAction, type ServerActionAt } from '@effect-trpc/next';
 * import { Schema } from 'effect';
 *
 * // server/router.ts (schemas only) in a real app
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {
 *   get headline(): string {
 *     return `#${this.id} ${this.title}`;
 *   }
 * }
 * class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {
 *   reason: Schema.String,
 * }) {}
 * const appRouter = Router.make({
 *   post: {
 *     create: mutation({ payload: { title: Schema.String }, success: Post, error: Forbidden }),
 *   },
 * });
 * // `import { createPost } from './actions'` in the app (a 'use server' module).
 * declare const createPost: ServerActionAt<typeof appRouter, 'post.create'>;
 *
 * export function NewPost() {
 *   const create = useServerAction(createPost, { router: appRouter, path: 'post.create' });
 *   return (
 *     <form action={(form) => void create.run({ title: String(form.get('title')) })}>
 *       <input name="title" />
 *       <button disabled={create.isPending}>Create</button>
 *       {create.data && <p>Created {create.data.headline}</p>}
 *       {create.error?._tag === 'Forbidden' && <p>Forbidden: {create.error.reason}</p>}
 *     </form>
 *   );
 * }
 * ```
 *
 * @see {@link createServerActionCaller}
 * @see {@link unwrapActionResult}
 * @category hooks
 * @since 0.1.0
 */
export const useServerAction = <
  Args extends ReadonlyArray<unknown>,
  A,
  E,
  R extends Router.Any,
  const P extends ActionPath<R>,
>(
  action: (...args: Args) => PromiseLike<EncodedActionResult<A, E>>,
  options: UseServerActionOptions<R, P> & CheckActionPath<R, P, A, E>,
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
