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

/** `mutationOptions` input options: `useMutation` options without key and function. */
export type RpcMutationOptionsIn<TInput, TError, TOutput, TContext> = DistributiveOmit<
  UseMutationOptions<TOutput, TError, TInput, TContext>,
  ReservedOptions
> &
  RpcQueryBaseOptions;

/** `mutationOptions` result: `useMutation` options with `mutationKey`, `mutationFn` and `.rpc`. */
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
 * `rpc.<mutation>.mutationOptions(opts?)`: type-safe options for `useMutation` (tRPC's
 * `TRPCMutationOptions`). Variables are the procedure input, `error` is `ClientError<E>`.
 */
export interface RpcMutationOptions<
  TDef extends ResolverDef,
  TFeatureFlags extends FeatureFlags = DefaultFeatureFlags,
> {
  <TContext = unknown>(
    opts?: RpcMutationOptionsIn<TDef['input'], TDef['error'], TDef['output'], TContext>,
  ): RpcMutationOptionsOut<TDef['input'], TDef['error'], TDef['output'], TContext, TFeatureFlags>;
}

/** Overrides the `onSuccess` of every mutation (tRPC's `overrides.mutations.onSuccess`). */
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
