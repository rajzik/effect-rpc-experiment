/**
 * Types and the builder behind `rpc.<query>.queryOptions(input, opts)`.
 *
 * The options proxy calls the internal builder for every `queryOptions(...)` call. It returns
 * TanStack's own `queryOptions(...)` object with a data-tagged `queryKey`, a `queryFn` that calls
 * the Promise client with TanStack's `AbortSignal`, and `.rpc.path` metadata. The
 * `Undefined*` / `Defined*` / `UnusedSkipToken*` pairs mirror TanStack's overloads, so the
 * result works with `useQuery`, `useSuspenseQuery`, `useQueries`, `fetchQuery` and
 * `prefetchQuery`.
 *
 * @since 0.1.0
 */
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

/**
 * `queryOptions` input options without `initialData`: every TanStack `useQuery` option except
 * `queryKey`, `queryFn`, `queryHash` and `queryHashFn`, plus `rpc: { headers }`.
 *
 * @see {@link RpcQueryOptions}
 * @category options
 * @since 0.1.0
 */
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

/**
 * `queryOptions` result without `initialData`: `data` may be `undefined`.
 *
 * @see {@link RpcQueryOptions}
 * @category options
 * @since 0.1.0
 */
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

/**
 * `queryOptions` input options with `initialData` (TanStack's `DefinedInitialDataOptions`).
 *
 * @see {@link RpcQueryOptions}
 * @category options
 * @since 0.1.0
 */
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

/**
 * `queryOptions` result with `initialData`: `useQuery(...).data` is always defined.
 *
 * @see {@link RpcQueryOptions}
 * @category options
 * @since 0.1.0
 */
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

/**
 * `queryOptions` input options when the input is not `skipToken`.
 *
 * @see {@link RpcQueryOptions}
 * @category options
 * @since 0.1.0
 */
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

/**
 * `queryOptions` result when the input is not `skipToken`; usable with `useSuspenseQuery`.
 *
 * @see {@link RpcQueryOptions}
 * @category options
 * @since 0.1.0
 */
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
 * The signature of `rpc.<query>.queryOptions(input | skipToken, opts?)`: type-safe options for
 * `useQuery`, `useSuspenseQuery`, `queryClient.fetchQuery`, ... (tRPC's `TRPCQueryOptions`).
 *
 * **When to use**
 *
 * Use for every query procedure call from React or TanStack Query. Prefer `infiniteQueryOptions`
 * for cursor pagination and the Promise client (`useRpcClient()`) for one-off imperative calls
 * that should not be cached.
 *
 * **Details**
 *
 * - `data` is the decoded output: `Schema.Class` values are real instances (methods and `Date`
 *   fields work).
 * - `error` is `ClientError<E>`: one of the procedure's `Schema.TaggedError`s, `RpcDefect`,
 *   `RpcTransportError` or `RpcInterrupted`. Narrow it by `_tag`.
 * - `queryKey` is `[path, { input?, type: "query" }]` and data-tagged, so
 *   `queryClient.getQueryData(opts.queryKey)` is typed. The result also carries `.rpc.path`
 *   (`"post.byId"`).
 * - `opts` accepts every `useQuery` option except key / function / hash, plus
 *   `rpc: { headers }` for per-request headers merged over the client's headers.
 * - TanStack's `AbortSignal` is passed to the call: cancelling the query interrupts the handler.
 *
 * **Gotchas**
 *
 * - Pass `skipToken` (re-exported from this package) as the input to disable the query in a
 *   type-safe way. Options built with a possible `skipToken` are rejected by `useSuspenseQuery`
 *   at the type level.
 * - Do not wrap the error yourself or look for `error.data.code` (tRPC's `TRPCClientError`): the
 *   error *is* the tagged class instance.
 * - Retrying typed errors is pointless; restrict `retry` to `RpcTransportError`.
 *
 * **Example** (A component that narrows the error by `_tag`)
 *
 * ```tsx
 * import { query, Router } from '@effect-trpc/core';
 * import type { RpcOptionsProxy } from '@effect-trpc/tanstack-react-query';
 * import { skipToken } from '@effect-trpc/tanstack-react-query';
 * import { useQuery } from '@tanstack/react-query';
 * import { Schema } from 'effect';
 *
 * class Post extends Schema.Class<Post>('Post')({
 *   id: Schema.Number,
 *   title: Schema.String,
 *   createdAt: Schema.Date,
 * }) {
 *   get headline(): string {
 *     return `${this.title} (${this.createdAt.getUTCFullYear()})`;
 *   }
 * }
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 *
 * // From `createRpcContext<typeof appRouter>()`.
 * declare const useRpc: () => RpcOptionsProxy<typeof appRouter>;
 *
 * export function PostView({ id }: { id: number | undefined }) {
 *   const rpc = useRpc();
 *   const post = useQuery(
 *     rpc.post.byId.queryOptions(id === undefined ? skipToken : { id }, { staleTime: 30_000 }),
 *   );
 *   if (post.error) {
 *     switch (post.error._tag) {
 *       case 'PostNotFound':
 *         return <p>No post #{post.error.id}</p>;
 *       default: // RpcDefect | RpcTransportError | RpcInterrupted
 *         return <p>Something went wrong: {post.error.message}</p>;
 *     }
 *   }
 *   if (!post.data) return <p>Loading…</p>;
 *   return <h1>{post.data.headline}</h1>; // a real Post instance
 * }
 * ```
 *
 * **Example** (Suspense, `select` and per-request headers)
 *
 * ```tsx
 * import { query, Router } from '@effect-trpc/core';
 * import type { RpcOptionsProxy } from '@effect-trpc/tanstack-react-query';
 * import { useSuspenseQuery } from '@tanstack/react-query';
 * import { Schema } from 'effect';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post }) },
 * });
 * declare const useRpc: () => RpcOptionsProxy<typeof appRouter>;
 *
 * export function PostTitle({ id }: { id: number }) {
 *   const rpc = useRpc();
 *   const { data: title } = useSuspenseQuery(
 *     rpc.post.byId.queryOptions(
 *       { id },
 *       { select: (post) => post.title, rpc: { headers: { 'x-request-source': 'title' } } },
 *     ),
 *   );
 *   return <h1>{title}</h1>; // string, never undefined under Suspense
 * }
 * ```
 *
 * @see DecorateQueryProcedure
 * @see RpcInfiniteQueryOptions
 * @category options
 * @since 0.1.0
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
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the proxy erases the rpc types; the public `queryOptions` signature restores them
      ...(opts as UndefinedInitialDataOptions<unknown, unknown, unknown, RpcQueryKey<boolean>>),
      queryKey,
      queryFn: input === skipToken ? skipToken : queryFn,
    }),
    { rpc: createRpcOptionsResult(path) },
  );
};
