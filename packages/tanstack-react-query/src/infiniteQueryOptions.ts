/**
 * Types and the builder behind `rpc.<query>.infiniteQueryOptions(input, opts)`.
 *
 * Only query procedures whose input has a `cursor` key get `infiniteQueryOptions` (see
 * `DecorateProcedure`). The builder returns TanStack's own `infiniteQueryOptions(...)` object: the
 * key drops `cursor` from the input, each page is fetched with the input's `cursor` replaced by
 * the page param, and the first page param is `initialCursor` or the input's `cursor`.
 *
 * @since 0.1.0
 */
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

/**
 * `infiniteQueryOptions` input options without `initialData`: TanStack's infinite options
 * except `queryKey`, `queryFn`, hashes and `initialPageParam`, plus `initialCursor` and `rpc`.
 *
 * @see {@link RpcInfiniteQueryOptions}
 * @category options
 * @since 0.1.0
 */
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

/**
 * `infiniteQueryOptions` result without `initialData`.
 *
 * @see {@link RpcInfiniteQueryOptions}
 * @category options
 * @since 0.1.0
 */
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

/**
 * `infiniteQueryOptions` input options with `initialData`.
 *
 * @see {@link RpcInfiniteQueryOptions}
 * @category options
 * @since 0.1.0
 */
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

/**
 * `infiniteQueryOptions` result with `initialData`: `data` is always defined.
 *
 * @see {@link RpcInfiniteQueryOptions}
 * @category options
 * @since 0.1.0
 */
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

/**
 * `infiniteQueryOptions` input options when the input is not `skipToken`.
 *
 * @see {@link RpcInfiniteQueryOptions}
 * @category options
 * @since 0.1.0
 */
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

/**
 * `infiniteQueryOptions` result when the input is not `skipToken`; usable with
 * `useSuspenseInfiniteQuery`.
 *
 * @see {@link RpcInfiniteQueryOptions}
 * @category options
 * @since 0.1.0
 */
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
 * The signature of `rpc.<query>.infiniteQueryOptions(input | skipToken, opts)`: options for
 * `useInfiniteQuery`, `useSuspenseInfiniteQuery` and `prefetchInfiniteQuery` (tRPC's
 * `TRPCInfiniteQueryOptions`).
 *
 * **When to use**
 *
 * Use for cursor-paginated query procedures (an input with an optional `cursor`). Prefer
 * `queryOptions` for everything else.
 *
 * **Details**
 *
 * - Only available when the input has a `cursor` key; other queries do not have the helper.
 * - Each page is fetched with the input's `cursor` replaced by the page param. The first page
 *   param is `initialCursor`, else the input's `cursor` (often `undefined`).
 * - `getNextPageParam` is required by TanStack; return `null` / `undefined` to stop.
 * - The key is `[path, { input, type: "infinite" }]` with `cursor` removed from `input`.
 *
 * **Gotchas**
 *
 * - Unlike tRPC, no `direction` field is added to the input; use `getPreviousPageParam` and your
 *   own cursor encoding for bidirectional lists.
 * - The input's `cursor` is not part of the key: two calls that differ only by `cursor` share one
 *   cache entry. Set the first page with `initialCursor` and let `getNextPageParam` drive paging.
 *
 * **Example** (A "load more" list)
 *
 * ```tsx
 * import { query, Router } from '@effect-trpc/core';
 * import type { RpcOptionsProxy } from '@effect-trpc/tanstack-react-query';
 * import { useInfiniteQuery } from '@tanstack/react-query';
 * import { Schema } from 'effect';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * const appRouter = Router.make({
 *   post: {
 *     // The `cursor` key enables infiniteQueryOptions.
 *     list: query({
 *       payload: { cursor: Schema.optional(Schema.NullOr(Schema.Number)) },
 *       success: Schema.Struct({
 *         items: Schema.Array(Post),
 *         nextCursor: Schema.NullOr(Schema.Number),
 *       }),
 *     }),
 *   },
 * });
 * declare const useRpc: () => RpcOptionsProxy<typeof appRouter>;
 *
 * export function PostList() {
 *   const rpc = useRpc();
 *   const posts = useInfiniteQuery(
 *     rpc.post.list.infiniteQueryOptions({}, { getNextPageParam: (page) => page.nextCursor }),
 *   );
 *   return (
 *     <ul>
 *       {posts.data?.pages.flatMap((page) => page.items.map((p) => <li key={p.id}>{p.title}</li>))}
 *       {posts.hasNextPage && (
 *         <li>
 *           <button onClick={() => void posts.fetchNextPage()}>more</button>
 *         </li>
 *       )}
 *     </ul>
 *   );
 * }
 * ```
 *
 * **Example** (Prefetching two pages outside React)
 *
 * ```ts
 * import type { Client } from '@effect-trpc/client';
 * import { query, Router } from '@effect-trpc/core';
 * import { createRpcOptionsProxy } from '@effect-trpc/tanstack-react-query';
 * import { QueryClient } from '@tanstack/react-query';
 * import { Schema } from 'effect';
 *
 * const appRouter = Router.make({
 *   post: {
 *     list: query({
 *       payload: { cursor: Schema.optional(Schema.NullOr(Schema.Number)) },
 *       success: Schema.Struct({
 *         titles: Schema.Array(Schema.String),
 *         nextCursor: Schema.NullOr(Schema.Number),
 *       }),
 *     }),
 *   },
 * });
 * declare const client: Client<typeof appRouter>;
 *
 * const queryClient = new QueryClient();
 * const rpc = createRpcOptionsProxy({ client, queryClient });
 *
 * export const prefetchList = () =>
 *   queryClient.prefetchInfiniteQuery({
 *     ...rpc.post.list.infiniteQueryOptions(
 *       {},
 *       { initialCursor: 0, getNextPageParam: (page) => page.nextCursor },
 *     ),
 *     pages: 2,
 *   });
 * ```
 *
 * @see DecorateInfiniteQueryProcedure
 * @see RpcQueryOptions
 * @category options
 * @since 0.1.0
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
