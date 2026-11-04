/**
 * Types and the builder behind `rpc.<mutation>.mutationOptions(opts)`.
 *
 * The builder returns `useMutation` options with a `mutationKey` (`[path]`, prefixed with a key
 * prefix), a `mutationFn` that calls the Promise client with the variables as input, and
 * `.rpc.path` metadata. When the options proxy has a `queryClient`, `onSuccess` is wrapped so
 * that `overrides.mutations.onSuccess` and the `onSuccess` of `setMutationDefaults` run.
 *
 * @since 0.1.0
 */
import type { MutationFunction, QueryClient, UseMutationOptions } from '@tanstack/react-query';
import { callOptions, type ProcedureCaller } from './internals/call.js';
import { createRpcOptionsResult, getMutationKeyInternal } from './internals/keys.js';
import type {
  DefaultFeatureFlags,
  DistributiveOmit,
  FeatureFlags,
  MaybePromise,
  ResolverDef,
  RpcMutationKey,
  RpcOptionsResult,
  RpcQueryBaseOptions,
} from './internals/types.js';

type ReservedOptions = 'mutationKey' | 'mutationFn';

/**
 * `mutationOptions` input options: `useMutation` options without `mutationKey` / `mutationFn`,
 * plus `rpc: { headers }`.
 *
 * @see {@link RpcMutationOptions}
 * @category options
 * @since 0.1.0
 */
export type RpcMutationOptionsIn<TInput, TError, TOutput, TContext> = DistributiveOmit<
  UseMutationOptions<TOutput, TError, TInput, TContext>,
  ReservedOptions
> &
  RpcQueryBaseOptions;

/**
 * `mutationOptions` result: `useMutation` options with `mutationKey`, `mutationFn` and `.rpc`.
 *
 * @see {@link RpcMutationOptions}
 * @category options
 * @since 0.1.0
 */
export interface RpcMutationOptionsOut<
  TInput,
  TError,
  TOutput,
  TContext,
  TFeatureFlags extends FeatureFlags,
>
  extends UseMutationOptions<TOutput, TError, TInput, TContext>, RpcOptionsResult {
  mutationKey: RpcMutationKey<TFeatureFlags['keyPrefix']>;
}

/**
 * The signature of `rpc.<mutation>.mutationOptions(opts?)`: type-safe options for `useMutation`
 * (tRPC's `TRPCMutationOptions`).
 *
 * **When to use**
 *
 * Use for every mutation procedure called from React. Invalidate affected queries in
 * `onSuccess` with `pathFilter()` / `queryFilter()` from the same proxy.
 *
 * **Details**
 *
 * - Variables are the procedure input; `mutate()` takes no argument for procedures without input.
 * - `data` is the decoded output (class instances), `error` is `ClientError<E>`.
 * - `mutationKey` is `[path]` (`[[prefix], path]` with a key prefix), so
 *   `queryClient.setMutationDefaults(rpc.post.create.mutationKey(), ...)` targets it.
 * - `opts.rpc.headers` adds headers to every call of this mutation.
 *
 * **Gotchas**
 *
 * - tRPC-v10 `rpc.post.create.useMutation()` does not exist: call
 *   `useMutation(rpc.post.create.mutationOptions(...))`.
 * - Mutations are not given an `AbortSignal`, so a running mutation is not interrupted on unmount.
 *
 * **Example** (Create, then invalidate every `post.*` query)
 *
 * ```tsx
 * import { mutation, query, Router } from '@effect-trpc/core';
 * import type { RpcOptionsProxy } from '@effect-trpc/tanstack-react-query';
 * import { useMutation, useQueryClient } from '@tanstack/react-query';
 * import { Schema } from 'effect';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', { reason: Schema.String }) {}
 * const appRouter = Router.make({
 *   post: {
 *     list: query({ success: Schema.Array(Post) }),
 *     create: mutation({ payload: { title: Schema.String }, success: Post, error: Forbidden }),
 *   },
 * });
 * declare const useRpc: () => RpcOptionsProxy<typeof appRouter>;
 *
 * export function CreatePost() {
 *   const rpc = useRpc();
 *   const queryClient = useQueryClient();
 *   const create = useMutation(
 *     rpc.post.create.mutationOptions({
 *       onSuccess: () => queryClient.invalidateQueries(rpc.post.pathFilter()),
 *     }),
 *   );
 *   return (
 *     <>
 *       <button onClick={() => create.mutate({ title: 'Hello' })}>Create</button>
 *       {create.error?._tag === 'Forbidden' && <p>Not allowed: {create.error.reason}</p>}
 *     </>
 *   );
 * }
 * ```
 *
 * **Example** (Optimistic update through the data-tagged key)
 *
 * ```tsx
 * import { mutation, query, Router } from '@effect-trpc/core';
 * import type { RpcOptionsProxy } from '@effect-trpc/tanstack-react-query';
 * import { useMutation, useQueryClient } from '@tanstack/react-query';
 * import { Schema } from 'effect';
 *
 * const appRouter = Router.make({
 *   titles: query({ success: Schema.Array(Schema.String) }),
 *   addTitle: mutation({ payload: { title: Schema.String }, success: Schema.String }),
 * });
 * declare const useRpc: () => RpcOptionsProxy<typeof appRouter>;
 *
 * export function useAddTitle() {
 *   const rpc = useRpc();
 *   const queryClient = useQueryClient();
 *   const key = rpc.titles.queryKey();
 *   return useMutation(
 *     rpc.addTitle.mutationOptions({
 *       onMutate: async ({ title }) => {
 *         await queryClient.cancelQueries({ queryKey: key });
 *         const previous = queryClient.getQueryData(key); // ReadonlyArray<string> | undefined
 *         queryClient.setQueryData(key, (old) => [...(old ?? []), title]);
 *         return { previous };
 *       },
 *       onError: (_error, _input, context) => {
 *         queryClient.setQueryData(key, context?.previous);
 *       },
 *       onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
 *     }),
 *   );
 * }
 * ```
 *
 * @see DecorateMutationProcedure
 * @see {@link MutationOptionsOverride}
 * @category options
 * @since 0.1.0
 */
export interface RpcMutationOptions<
  TDef extends ResolverDef,
  TFeatureFlags extends FeatureFlags = DefaultFeatureFlags,
> {
  <TContext = unknown>(
    opts?: RpcMutationOptionsIn<TDef['input'], TDef['error'], TDef['output'], TContext>,
  ): RpcMutationOptionsOut<TDef['input'], TDef['error'], TDef['output'], TContext, TFeatureFlags>;
}

/**
 * Wraps the `onSuccess` of every mutation of an options proxy (tRPC's
 * `overrides.mutations.onSuccess`), passed as `createRpcOptionsProxy({ overrides: { mutations } })`.
 *
 * **When to use**
 *
 * Use for app-wide behaviour after any successful mutation, typically "invalidate everything".
 *
 * **Details**
 *
 * - `originalFn()` runs the `onSuccess` given to `mutationOptions`, or else the one from
 *   `setMutationDefaults`. The wrapper decides whether and when to call it.
 * - `meta` is the mutation's `meta` (or the defaults' `meta`, or `{}`).
 * - Requires the `queryClient` option of `createRpcOptionsProxy`; without it `mutationOptions()`
 *   throws.
 * - `createRpcContext`'s `RpcProvider` does not accept overrides; use `createRpcOptionsProxy`
 *   directly when you need them.
 *
 * @see createRpcOptionsProxy
 * @category options
 * @since 0.1.0
 */
export interface MutationOptionsOverride {
  readonly onSuccess: (opts: {
    /** Calls the `onSuccess` given to `mutationOptions` (or the mutation defaults). */
    readonly originalFn: () => MaybePromise<unknown>;
    readonly queryClient: QueryClient;
    /** The `meta` given to `mutationOptions` (or the mutation defaults). */
    readonly meta: Record<string, unknown>;
  }) => MaybePromise<unknown>;
}

type AnyMutationOptionsIn = RpcMutationOptionsIn<unknown, unknown, unknown, unknown>;
type AnyOnSuccess = (...args: ReadonlyArray<unknown>) => unknown;

/** @internal Builds the options of `mutationOptions`. */
export const rpcMutationOptions = (args: {
  readonly call: ProcedureCaller;
  readonly queryClient: QueryClient | undefined;
  readonly path: ReadonlyArray<string>;
  readonly prefix: string | undefined;
  readonly opts: AnyMutationOptionsIn | undefined;
  readonly overrides: MutationOptionsOverride | undefined;
}): unknown => {
  const { call, queryClient, path, prefix, opts, overrides } = args;
  const mutationKey = getMutationKeyInternal({ path, prefix });
  const mutationFn: MutationFunction = (input) =>
    call(path, input, callOptions(undefined, opts?.rpc)) as Promise<unknown>;
  const base = { ...opts, mutationKey, mutationFn, rpc: createRpcOptionsResult(path) };
  if (queryClient === undefined) {
    if (overrides !== undefined) {
      throw new Error(
        'createRpcOptionsProxy: `overrides.mutations` requires the `queryClient` option',
      );
    }
    return base;
  }
  // The returned `onSuccess` replaces the one of `setMutationDefaults`, so call it explicitly.
  const defaults = queryClient.defaultMutationOptions(queryClient.getMutationDefaults(mutationKey));
  const override: MutationOptionsOverride['onSuccess'] =
    overrides?.onSuccess ?? ((options) => options.originalFn());
  return {
    ...base,
    onSuccess: (...successArgs: ReadonlyArray<unknown>) => {
      const own = opts?.onSuccess as AnyOnSuccess | undefined;
      const fallback = defaults.onSuccess as AnyOnSuccess | undefined;
      const originalFn = () =>
        own === undefined ? fallback?.(...successArgs) : own(...successArgs);
      return override({
        originalFn,
        queryClient,
        meta: opts?.meta ?? defaults.meta ?? {},
      });
    },
  };
};
