import type {
  DataTag,
  DefinedInitialDataOptions,
  QueryFunction,
  SkipToken,
  UndefinedInitialDataOptions,
  UnusedSkipTokenOptions,
} from '@tanstack/react-query';
import { queryOptions, skipToken } from '@tanstack/react-query';
import { callOptions, type ProcedureCaller } from './internals/call.js';
import { createRpcOptionsResult } from './internals/keys.js';
import type {
  DefaultFeatureFlags,
  DistributiveOmit,
  FeatureFlags,
  ResolverDef,
  RpcOptionsResult,
  RpcQueryBaseOptions,
  RpcQueryKey,
} from './internals/types.js';

type ReservedOptions = 'queryKey' | 'queryFn' | 'queryHashFn' | 'queryHash';

/** `queryOptions` input options without `initialData`. */
export interface UndefinedRpcQueryOptionsIn<
  TQueryFnData,
  TData,
  TError,
  TFeatureFlags extends FeatureFlags,
>
  extends
    DistributiveOmit<
      UndefinedInitialDataOptions<
        TQueryFnData,
        TError,
        TData,
        RpcQueryKey<TFeatureFlags['keyPrefix']>
      >,
      ReservedOptions
    >,
    RpcQueryBaseOptions {}

/** `queryOptions` result without `initialData`. */
export interface UndefinedRpcQueryOptionsOut<
  TQueryFnData,
  TOutput,
  TError,
  TFeatureFlags extends FeatureFlags,
>
  extends
    UndefinedInitialDataOptions<
      TQueryFnData,
      TError,
      TOutput,
      RpcQueryKey<TFeatureFlags['keyPrefix']>
    >,
    RpcOptionsResult {
  queryKey: DataTag<RpcQueryKey<TFeatureFlags['keyPrefix']>, TQueryFnData, TError>;
}

/** `queryOptions` input options with `initialData`. */
export interface DefinedRpcQueryOptionsIn<
  TQueryFnData,
  TData,
  TError,
  TFeatureFlags extends FeatureFlags,
>
  extends
    DistributiveOmit<
      DefinedInitialDataOptions<
        NoInfer<TQueryFnData>,
        TError,
        TData,
        RpcQueryKey<TFeatureFlags['keyPrefix']>
      >,
      ReservedOptions
    >,
    RpcQueryBaseOptions {}

/** `queryOptions` result with `initialData`. */
export interface DefinedRpcQueryOptionsOut<
  TQueryFnData,
  TData,
  TError,
  TFeatureFlags extends FeatureFlags,
>
  extends
    DefinedInitialDataOptions<TQueryFnData, TError, TData, RpcQueryKey<TFeatureFlags['keyPrefix']>>,
    RpcOptionsResult {
  queryKey: DataTag<RpcQueryKey<TFeatureFlags['keyPrefix']>, TQueryFnData, TError>;
}

/** `queryOptions` input options when the input is not `skipToken`. */
export interface UnusedSkipTokenRpcQueryOptionsIn<
  TQueryFnData,
  TData,
  TError,
  TFeatureFlags extends FeatureFlags,
>
  extends
    DistributiveOmit<
      UnusedSkipTokenOptions<TQueryFnData, TError, TData, RpcQueryKey<TFeatureFlags['keyPrefix']>>,
      ReservedOptions
    >,
    RpcQueryBaseOptions {}

/** `queryOptions` result when the input is not `skipToken` (usable with `useSuspenseQuery`). */
export interface UnusedSkipTokenRpcQueryOptionsOut<
  TQueryFnData,
  TOutput,
  TError,
  TFeatureFlags extends FeatureFlags,
>
  extends
    UnusedSkipTokenOptions<TQueryFnData, TError, TOutput, RpcQueryKey<TFeatureFlags['keyPrefix']>>,
    RpcOptionsResult {
  queryKey: DataTag<RpcQueryKey<TFeatureFlags['keyPrefix']>, TQueryFnData, TError>;
}

/**
 * `rpc.<query>.queryOptions(input | skipToken, opts?)`: type-safe options for `useQuery`,
 * `useSuspenseQuery`, `queryClient.fetchQuery`, ... (tRPC's `TRPCQueryOptions`). `error` is
 * `ClientError<E>`; `queryKey` is data-tagged, so `queryClient.getQueryData(opts.queryKey)` is typed.
 */
export interface RpcQueryOptions<
  TDef extends ResolverDef,
  TFeatureFlags extends FeatureFlags = DefaultFeatureFlags,
> {
  <TQueryFnData extends TDef['output'], TData = TQueryFnData>(
    input: TDef['input'] | SkipToken,
    opts: DefinedRpcQueryOptionsIn<TQueryFnData, TData, TDef['error'], TFeatureFlags>,
  ): DefinedRpcQueryOptionsOut<TQueryFnData, TData, TDef['error'], TFeatureFlags>;
  <TQueryFnData extends TDef['output'], TData = TQueryFnData>(
    input: TDef['input'],
    opts?: UnusedSkipTokenRpcQueryOptionsIn<TQueryFnData, TData, TDef['error'], TFeatureFlags>,
  ): UnusedSkipTokenRpcQueryOptionsOut<TQueryFnData, TData, TDef['error'], TFeatureFlags>;
  <TQueryFnData extends TDef['output'], TData = TQueryFnData>(
    input: TDef['input'] | SkipToken,
    opts?: UndefinedRpcQueryOptionsIn<TQueryFnData, TData, TDef['error'], TFeatureFlags>,
  ): UndefinedRpcQueryOptionsOut<TQueryFnData, TData, TDef['error'], TFeatureFlags>;
}

type AnyRpcQueryOptionsIn =
  | DefinedRpcQueryOptionsIn<unknown, unknown, unknown, FeatureFlags>
  | UnusedSkipTokenRpcQueryOptionsIn<unknown, unknown, unknown, FeatureFlags>
  | UndefinedRpcQueryOptionsIn<unknown, unknown, unknown, FeatureFlags>;

/** @internal Builds the options of `queryOptions`. */
export const rpcQueryOptions = (args: {
  readonly input: unknown;
  readonly call: ProcedureCaller;
  readonly path: ReadonlyArray<string>;
  readonly queryKey: RpcQueryKey<boolean>;
  readonly opts: AnyRpcQueryOptionsIn | undefined;
}): unknown => {
  const { input, call, path, queryKey, opts } = args;
  const queryFn: QueryFunction<unknown, RpcQueryKey<boolean>> = (context) =>
    call(path, input, callOptions(context.signal, opts?.rpc));
  return Object.assign(
    queryOptions({
      ...(opts as UndefinedInitialDataOptions<unknown, unknown, unknown, RpcQueryKey<boolean>>),
      queryKey,
      queryFn: input === skipToken ? skipToken : queryFn,
    }),
    { rpc: createRpcOptionsResult(path) },
  );
};
