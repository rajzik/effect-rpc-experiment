import type {
  DataTag,
  DefinedInitialDataInfiniteOptions,
  QueryFunction,
  SkipToken,
  UndefinedInitialDataInfiniteOptions,
  UnusedSkipTokenInfiniteOptions,
} from '@tanstack/react-query';
import { infiniteQueryOptions, skipToken } from '@tanstack/react-query';
import { callOptions, type ProcedureCaller } from './internals/call.js';
import { createRpcOptionsResult } from './internals/keys.js';
import type {
  DistributiveOmit,
  FeatureFlags,
  ResolverDef,
  RpcInfiniteData,
  RpcOptionsResult,
  RpcPageParam,
  RpcQueryBaseOptions,
  RpcQueryKey,
} from './internals/types.js';

type ReservedOptions = 'queryKey' | 'queryFn' | 'queryHashFn' | 'queryHash' | 'initialPageParam';

/** Extra input options of `infiniteQueryOptions`. */
interface CursorOptions<TInput> {
  /** The cursor of the first page. Defaults to the `cursor` of the input. */
  initialCursor?: RpcPageParam<TInput>;
}

/** `infiniteQueryOptions` input options without `initialData`. */
export interface UndefinedRpcInfiniteQueryOptionsIn<
  TInput,
  TQueryFnData,
  TData,
  TError,
  TFeatureFlags extends FeatureFlags,
>
  extends
    DistributiveOmit<
      UndefinedInitialDataInfiniteOptions<
        TQueryFnData,
        TError,
        RpcInfiniteData<TInput, TData>,
        RpcQueryKey<TFeatureFlags['keyPrefix']>,
        RpcPageParam<TInput>
      >,
      ReservedOptions
    >,
    RpcQueryBaseOptions,
    CursorOptions<TInput> {}

/** `infiniteQueryOptions` result without `initialData`. */
export interface UndefinedRpcInfiniteQueryOptionsOut<
  TInput,
  TQueryFnData,
  TData,
  TError,
  TFeatureFlags extends FeatureFlags,
>
  extends
    DistributiveOmit<
      UndefinedInitialDataInfiniteOptions<
        TQueryFnData,
        TError,
        RpcInfiniteData<TInput, TData>,
        RpcQueryKey<TFeatureFlags['keyPrefix']>,
        RpcPageParam<TInput>
      >,
      'initialPageParam'
    >,
    RpcOptionsResult {
  queryKey: DataTag<
    RpcQueryKey<TFeatureFlags['keyPrefix']>,
    RpcInfiniteData<TInput, TQueryFnData>,
    TError
  >;
  initialPageParam: RpcPageParam<TInput>;
}

/** `infiniteQueryOptions` input options with `initialData`. */
export interface DefinedRpcInfiniteQueryOptionsIn<
  TInput,
  TQueryFnData,
  TData,
  TError,
  TFeatureFlags extends FeatureFlags,
>
  extends
    DistributiveOmit<
      DefinedInitialDataInfiniteOptions<
        TQueryFnData,
        TError,
        RpcInfiniteData<TInput, TData>,
        RpcQueryKey<TFeatureFlags['keyPrefix']>,
        RpcPageParam<TInput>
      >,
      ReservedOptions
    >,
    RpcQueryBaseOptions,
    CursorOptions<TInput> {}

/** `infiniteQueryOptions` result with `initialData`. */
export interface DefinedRpcInfiniteQueryOptionsOut<
  TInput,
  TQueryFnData,
  TData,
  TError,
  TFeatureFlags extends FeatureFlags,
>
  extends
    DistributiveOmit<
      DefinedInitialDataInfiniteOptions<
        TQueryFnData,
        TError,
        RpcInfiniteData<TInput, TData>,
        RpcQueryKey<TFeatureFlags['keyPrefix']>,
        RpcPageParam<TInput>
      >,
      'initialPageParam'
    >,
    RpcOptionsResult {
  queryKey: DataTag<
    RpcQueryKey<TFeatureFlags['keyPrefix']>,
    RpcInfiniteData<TInput, TQueryFnData>,
    TError
  >;
  initialPageParam: RpcPageParam<TInput>;
}

/** `infiniteQueryOptions` input options when the input is not `skipToken`. */
export interface UnusedSkipTokenRpcInfiniteQueryOptionsIn<
  TInput,
  TQueryFnData,
  TData,
  TError,
  TFeatureFlags extends FeatureFlags,
>
  extends
    DistributiveOmit<
      UnusedSkipTokenInfiniteOptions<
        TQueryFnData,
        TError,
        RpcInfiniteData<TInput, TData>,
        RpcQueryKey<TFeatureFlags['keyPrefix']>,
        RpcPageParam<TInput>
      >,
      ReservedOptions
    >,
    RpcQueryBaseOptions,
    CursorOptions<TInput> {}

/** `infiniteQueryOptions` result when the input is not `skipToken`. */
export interface UnusedSkipTokenRpcInfiniteQueryOptionsOut<
  TInput,
  TQueryFnData,
  TData,
  TError,
  TFeatureFlags extends FeatureFlags,
>
  extends
    DistributiveOmit<
      UnusedSkipTokenInfiniteOptions<
        TQueryFnData,
        TError,
        RpcInfiniteData<TInput, TData>,
        RpcQueryKey<TFeatureFlags['keyPrefix']>,
        RpcPageParam<TInput>
      >,
      'initialPageParam'
    >,
    RpcOptionsResult {
  queryKey: DataTag<
    RpcQueryKey<TFeatureFlags['keyPrefix']>,
    RpcInfiniteData<TInput, TQueryFnData>,
    TError
  >;
  initialPageParam: RpcPageParam<TInput>;
}

/**
 * `rpc.<query>.infiniteQueryOptions(input | skipToken, opts)`: options for `useInfiniteQuery`
 * (tRPC's `TRPCInfiniteQueryOptions`). Only available when the input has a `cursor` key; each page
 * is fetched with the input's `cursor` replaced by the page param.
 */
export interface RpcInfiniteQueryOptions<TDef extends ResolverDef> {
  <TQueryFnData extends TDef['output'], TData = TQueryFnData>(
    input: TDef['input'] | SkipToken,
    opts: DefinedRpcInfiniteQueryOptionsIn<
      TDef['input'],
      TQueryFnData,
      TData,
      TDef['error'],
      TDef['featureFlags']
    >,
  ): DefinedRpcInfiniteQueryOptionsOut<
    TDef['input'],
    TQueryFnData,
    TData,
    TDef['error'],
    TDef['featureFlags']
  >;
  <TQueryFnData extends TDef['output'], TData = TQueryFnData>(
    input: TDef['input'],
    opts: UnusedSkipTokenRpcInfiniteQueryOptionsIn<
      TDef['input'],
      TQueryFnData,
      TData,
      TDef['error'],
      TDef['featureFlags']
    >,
  ): UnusedSkipTokenRpcInfiniteQueryOptionsOut<
    TDef['input'],
    TQueryFnData,
    TData,
    TDef['error'],
    TDef['featureFlags']
  >;
  <TQueryFnData extends TDef['output'], TData = TQueryFnData>(
    input: TDef['input'] | SkipToken,
    opts: UndefinedRpcInfiniteQueryOptionsIn<
      TDef['input'],
      TQueryFnData,
      TData,
      TDef['error'],
      TDef['featureFlags']
    >,
  ): UndefinedRpcInfiniteQueryOptionsOut<
    TDef['input'],
    TQueryFnData,
    TData,
    TDef['error'],
    TDef['featureFlags']
  >;
}

type AnyRpcInfiniteQueryOptionsIn =
  | DefinedRpcInfiniteQueryOptionsIn<any, any, any, any, FeatureFlags>
  | UnusedSkipTokenRpcInfiniteQueryOptionsIn<any, any, any, any, FeatureFlags>
  | UndefinedRpcInfiniteQueryOptionsIn<any, any, any, any, FeatureFlags>;

const cursorOf = (input: unknown): unknown =>
  typeof input === 'object' && input !== null && 'cursor' in input
    ? (input as { readonly cursor?: unknown }).cursor
    : undefined;

/** @internal Builds the options of `infiniteQueryOptions`. */
export const rpcInfiniteQueryOptions = (args: {
  readonly input: unknown;
  readonly call: ProcedureCaller;
  readonly path: ReadonlyArray<string>;
  readonly queryKey: RpcQueryKey<boolean>;
  readonly opts: AnyRpcInfiniteQueryOptionsIn | undefined;
}): unknown => {
  const { input, call, path, queryKey, opts } = args;
  const queryFn: QueryFunction<unknown, RpcQueryKey<boolean>, unknown> = (context) => {
    const base = typeof input === 'object' && input !== null ? input : {};
    const pageInput =
      context.pageParam === undefined ? base : { ...base, cursor: context.pageParam };
    return call(path, pageInput, callOptions(context.signal, opts?.rpc));
  };
  const { initialCursor, ...rest } = opts ?? ({} as AnyRpcInfiniteQueryOptionsIn);
  return Object.assign(
    infiniteQueryOptions({
      ...(rest as UndefinedInitialDataInfiniteOptions<
        unknown,
        unknown,
        unknown,
        RpcQueryKey<boolean>
      >),
      queryKey,
      queryFn: input === skipToken ? skipToken : queryFn,
      initialPageParam: initialCursor ?? cursorOf(input),
    }),
    { rpc: createRpcOptionsResult(path) },
  );
};
