/**
 * Builds the typed options proxy that mirrors a router and produces plain TanStack Query options.
 *
 * `createRpcOptionsProxy({ client, queryClient })` is the effect-trpc counterpart of tRPC's
 * `createTRPCOptionsProxy`. Every router node gets `pathKey` / `pathFilter`; every procedure gets
 * the helpers of its kind (`queryOptions`, `infiniteQueryOptions`, `mutationOptions`,
 * `subscriptionOptions` and the key/filter helpers). Calls go through the Promise client of
 * `@rpc-effect/client`, so `data` is the decoded output and `error` is `ClientError<E>` from
 * `@rpc-effect/core`. `createRpcContext` wraps this proxy for React.
 *
 * @since 0.1.0
 */
import type { Client } from '@rpc-effect/client';
import { Router } from '@rpc-effect/core';
import type { ProcedureDef, ProcedureKind } from '@rpc-effect/core';
import type { DataTag, QueryClient, QueryFilters } from '@tanstack/react-query';
import { rpcInfiniteQueryOptions, type RpcInfiniteQueryOptions } from './infiniteQueryOptions.js';
import type { ProcedureCaller } from './internals/call.js';
import { getMutationKeyInternal, getQueryKeyInternal, unwrapLazyArg } from './internals/keys.js';
import type {
  DefaultFeatureFlags,
  FeatureFlags,
  KeyPrefixOptions,
  OptionalCursorInput,
  ResolverDef,
  ResolverDefOf,
  RpcInfiniteData,
  RpcMutationKey,
  RpcQueryKey,
  WithRequired,
} from './internals/types.js';
import {
  rpcMutationOptions,
  type MutationOptionsOverride,
  type RpcMutationOptions,
} from './mutationOptions.js';
import { rpcQueryOptions, type RpcQueryOptions } from './queryOptions.js';
import { rpcSubscriptionOptions, type RpcSubscriptionOptions } from './subscriptionOptions.js';

/**
 * The `pathKey()` / `pathFilter()` helpers, available on the root, every router node and every
 * query procedure.
 *
 * **When to use**
 *
 * Use to invalidate, cancel, refetch or remove every query beneath a path, e.g.
 * `queryClient.invalidateQueries(rpc.post.pathFilter())` after a mutation. Prefer
 * `queryFilter(input)` to target one procedure (and optionally one input).
 *
 * **Details**
 *
 * - `rpc.post.pathKey()` is `[["post"]]`; `rpc.pathKey()` is `[]`, which matches every query.
 * - With a key prefix the key is `[[prefix], path]` (`[[prefix]]` for the root).
 * - Path keys match by prefix, so they cover query and infinite keys of every input.
 *
 * @see {@link DecorateQueryProcedure}
 * @category models
 * @since 0.1.0
 */
export interface DecorateRouterKeyable<TFeatureFlags extends FeatureFlags> {
  /**
   * The query key of this path: invalidate / cancel / remove every procedure beneath it.
   * `[path]`, `[]` for the root, `[[prefix], path]` with a key prefix.
   */
  pathKey: () => RpcQueryKey<TFeatureFlags['keyPrefix']>;
  /** A query filter for every procedure beneath this path. */
  pathFilter: (
    filters?: QueryFilters<RpcQueryKey<TFeatureFlags['keyPrefix']>>,
  ) => WithRequired<QueryFilters<RpcQueryKey<TFeatureFlags['keyPrefix']>>, 'queryKey'>;
}

/** Type-level helper: the procedure types (use `inferProxyInput` / `inferProxyOutput`). */
interface TypeHelper<TDef extends ResolverDef> {
  /** @internal Type-level only (`undefined` at runtime). */
  readonly '~types': {
    readonly input: TDef['input'];
    readonly output: TDef['output'];
    readonly error: TDef['error'];
  };
}

type QueryTag<TDef extends ResolverDef> = DataTag<
  RpcQueryKey<TDef['featureFlags']['keyPrefix']>,
  TDef['output'],
  TDef['error']
>;

type InfiniteQueryTag<TDef extends ResolverDef> = DataTag<
  RpcQueryKey<TDef['featureFlags']['keyPrefix']>,
  RpcInfiniteData<TDef['input'], TDef['output']>,
  TDef['error']
>;

/**
 * The infinite-query helpers of a query procedure whose input has a `cursor` key.
 *
 * **Details**
 *
 * - Present only when the input type has an optional `cursor` (or no input at all); otherwise
 *   `infiniteQueryOptions` does not exist on the procedure.
 * - Infinite keys are `[path, { input, type: "infinite" }]` with `cursor` (and `direction`)
 *   removed from `input`, so every page lives under one key.
 *
 * @see {@link RpcInfiniteQueryOptions}
 * @category models
 * @since 0.1.0
 */
export interface DecorateInfiniteQueryProcedure<TDef extends ResolverDef> extends TypeHelper<TDef> {
  /** Options for `useInfiniteQuery`, `prefetchInfiniteQuery`, ... */
  infiniteQueryOptions: RpcInfiniteQueryOptions<TDef>;
  /** The data-tagged key of an infinite query (`type: "infinite"`, without the cursor). */
  infiniteQueryKey: (input?: Partial<TDef['input']>) => InfiniteQueryTag<TDef>;
  /** A query filter for infinite queries of this procedure. */
  infiniteQueryFilter: (
    input?: Partial<TDef['input']>,
    filters?: QueryFilters<InfiniteQueryTag<TDef>>,
  ) => WithRequired<QueryFilters<InfiniteQueryTag<TDef>>, 'queryKey'>;
}

/**
 * The helpers of a query procedure: `queryOptions`, `queryKey`, `queryFilter`, plus `pathKey` /
 * `pathFilter`.
 *
 * **Details**
 *
 * - `queryKey(input?)` is `[path, { input?, type: "query" }]` and is data-tagged, so
 *   `queryClient.getQueryData(rpc.post.byId.queryKey({ id: 1 }))` is typed as the output.
 * - `queryKey()` / `queryFilter()` without input match every input of the procedure (TanStack
 *   matches keys by prefix); `input` may be `Partial`.
 *
 * @see {@link RpcQueryOptions}
 * @see {@link DecorateRouterKeyable}
 * @category models
 * @since 0.1.0
 */
export interface DecorateQueryProcedure<TDef extends ResolverDef>
  extends TypeHelper<TDef>, DecorateRouterKeyable<TDef['featureFlags']> {
  /** Options for `useQuery`, `useSuspenseQuery`, `fetchQuery`, `prefetchQuery`, ... */
  queryOptions: RpcQueryOptions<TDef, TDef['featureFlags']>;
  /** The data-tagged query key: `[path, { input?, type: "query" }]`. */
  queryKey: (input?: Partial<TDef['input']>) => QueryTag<TDef>;
  /** A query filter for this procedure (all inputs when `input` is omitted). */
  queryFilter: (
    input?: Partial<TDef['input']>,
    filters?: QueryFilters<QueryTag<TDef>>,
  ) => WithRequired<QueryFilters<QueryTag<TDef>>, 'queryKey'>;
}

/**
 * The helpers of a mutation procedure: `mutationOptions` and `mutationKey`.
 *
 * @see {@link RpcMutationOptions}
 * @category models
 * @since 0.1.0
 */
export interface DecorateMutationProcedure<TDef extends ResolverDef> extends TypeHelper<TDef> {
  /** Options for `useMutation`. */
  mutationOptions: RpcMutationOptions<TDef, TDef['featureFlags']>;
  /** The mutation key: `[path]` (`[[prefix], path]` with a key prefix). */
  mutationKey: () => RpcMutationKey<TDef['featureFlags']['keyPrefix']>;
}

/**
 * The helper of a subscription procedure: `subscriptionOptions`, consumed by `useSubscription`.
 *
 * @see {@link RpcSubscriptionOptions}
 * @category models
 * @since 0.1.0
 */
export interface DecorateSubscriptionProcedure<TDef extends ResolverDef> extends TypeHelper<TDef> {
  /** Options for `useSubscription`. */
  subscriptionOptions: RpcSubscriptionOptions<TDef, TDef['featureFlags']>;
}

/**
 * The helpers of one procedure, selected by its kind (`query`, `mutation`, `subscription`).
 *
 * **Details**
 *
 * - Queries get {@link DecorateQueryProcedure}, plus {@link DecorateInfiniteQueryProcedure} when
 *   the input has a `cursor` key.
 * - Calling a helper of another kind at runtime (e.g. `queryOptions` on a mutation) throws an
 *   `Error` that names the right helper.
 *
 * @category models
 * @since 0.1.0
 */
export type DecorateProcedure<
  TKind extends ProcedureKind,
  TDef extends ResolverDef,
> = TKind extends 'query'
  ? DecorateQueryProcedure<TDef> &
      (TDef['input'] extends OptionalCursorInput ? DecorateInfiniteQueryProcedure<TDef> : unknown)
  : TKind extends 'mutation'
    ? DecorateMutationProcedure<TDef>
    : TKind extends 'subscription'
      ? DecorateSubscriptionProcedure<TDef>
      : never;

type RecordOf<R> = R extends Router<infer Rec> ? Rec : R;

/**
 * A router record with every procedure replaced by its helpers and every nested router node
 * extended with `pathKey` / `pathFilter`.
 *
 * @see {@link RpcOptionsProxy}
 * @category models
 * @since 0.1.0
 */
export type DecoratedRouterRecord<Rec, TFeatureFlags extends FeatureFlags> = {
  readonly [K in keyof Rec]: Rec[K] extends ProcedureDef.Any
    ? DecorateProcedure<Rec[K]['kind'], ResolverDefOf<Rec[K], TFeatureFlags>>
    : DecoratedRouterRecord<RecordOf<Rec[K]>, TFeatureFlags> & DecorateRouterKeyable<TFeatureFlags>;
};

/**
 * The options proxy of a router (tRPC's `TRPCOptionsProxy`): it mirrors the router, with
 * `queryOptions` / `mutationOptions` / `subscriptionOptions` / key helpers on each procedure and
 * `pathKey` / `pathFilter` on every node.
 *
 * **When to use**
 *
 * Use as the type of a value returned by `useRpc()` or {@link createRpcOptionsProxy}, e.g. to
 * pass the proxy to a helper function or to write components against an abstract router.
 *
 * **Details**
 *
 * - The proxy is a recursive JS `Proxy`; only the helper calls do work. Calling a router node
 *   itself (`rpc.post()`) throws.
 * - The second type argument carries the feature flags (`{ keyPrefix: true }` for prefixed keys).
 *
 * **Example** (A helper that prefetches through the proxy)
 *
 * ```ts
 * import { mutation, query, Router } from '@rpc-effect/core';
 * import { Schema } from 'effect';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 * const appRouter = Router.make({
 *   post: {
 *     byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }),
 *     create: mutation({ payload: { title: Schema.String }, success: Post }),
 *   },
 * });
 * type AppRouter = typeof appRouter;
 * import type { RpcOptionsProxy } from '@rpc-effect/tanstack-react-query';
 * import type { QueryClient } from '@tanstack/react-query';
 *
 * export const prefetchPost = (rpc: RpcOptionsProxy<AppRouter>, queryClient: QueryClient, id: number) =>
 *   queryClient.prefetchQuery(rpc.post.byId.queryOptions({ id }));
 * ```
 *
 * @see {@link createRpcOptionsProxy}
 * @category models
 * @since 0.1.0
 */
export type RpcOptionsProxy<
  R extends Router.Any,
  TFeatureFlags extends FeatureFlags = DefaultFeatureFlags,
> = DecoratedRouterRecord<Router.Record<R>, TFeatureFlags> & DecorateRouterKeyable<TFeatureFlags>;

/**
 * The input type of a decorated procedure: `inferProxyInput<typeof rpc.post.byId>`.
 *
 * **Example** (Typing a form value from the procedure input)
 *
 * ```ts
 * import { mutation, query, Router } from '@rpc-effect/core';
 * import { Schema } from 'effect';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 * const appRouter = Router.make({
 *   post: {
 *     byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }),
 *     create: mutation({ payload: { title: Schema.String }, success: Post }),
 *   },
 * });
 * type AppRouter = typeof appRouter;
 * import type {
 *   inferProxyError,
 *   inferProxyInput,
 *   inferProxyOutput,
 *   RpcOptionsProxy,
 * } from '@rpc-effect/tanstack-react-query';
 *
 * declare const rpc: RpcOptionsProxy<AppRouter>;
 * type CreateInput = inferProxyInput<typeof rpc.post.create>; // { readonly title: string }
 * type ById = inferProxyOutput<typeof rpc.post.byId>; // Post
 * type ByIdError = inferProxyError<typeof rpc.post.byId>; // PostNotFound | RpcDefect | ...
 *
 * const draft: CreateInput = { title: 'Hello' };
 * ```
 *
 * @see {@link inferProxyOutput}
 * @see {@link inferProxyError}
 * @category type-level
 * @since 0.1.0
 */
export type inferProxyInput<
  TProcedure extends
    | DecorateQueryProcedure<any>
    | DecorateMutationProcedure<any>
    | DecorateSubscriptionProcedure<any>,
> = TProcedure['~types']['input'];

/**
 * The output type of a decorated procedure: `inferProxyOutput<typeof rpc.post.byId>` (the
 * element type for subscriptions).
 *
 * @see {@link inferProxyInput}
 * @category type-level
 * @since 0.1.0
 */
export type inferProxyOutput<
  TProcedure extends
    | DecorateQueryProcedure<any>
    | DecorateMutationProcedure<any>
    | DecorateSubscriptionProcedure<any>,
> = TProcedure['~types']['output'];

/**
 * The error type of a decorated procedure: `ClientError<E>`, i.e. the procedure's typed errors plus
 * `RpcDefect`, `RpcTransportError` and `RpcInterrupted`.
 *
 * @see {@link inferProxyInput}
 * @category type-level
 * @since 0.1.0
 */
export type inferProxyError<
  TProcedure extends
    | DecorateQueryProcedure<any>
    | DecorateMutationProcedure<any>
    | DecorateSubscriptionProcedure<any>,
> = TProcedure['~types']['error'];

/**
 * Options of {@link createRpcOptionsProxy} besides the client (also used by the framework
 * adapters).
 *
 * **Details**
 *
 * - `keyPrefix` is required exactly when the feature flags are `{ keyPrefix: true }`.
 * - `overrides.mutations.onSuccess` wraps the `onSuccess` of every mutation; it requires
 *   `queryClient`, otherwise `mutationOptions()` throws.
 *
 * @see {@link MutationOptionsOverride}
 * @category options
 * @since 0.1.0
 */
export type RpcOptionsProxyOptionsBase<TFeatureFlags extends FeatureFlags = DefaultFeatureFlags> = {
  /**
   * The query client (or a function returning it). Required by `overrides.mutations`. When it is
   * set, `mutationOptions` returns an `onSuccess` wrapper that also calls the `onSuccess` of
   * `queryClient.setMutationDefaults` for the mutation key itself.
   */
  readonly queryClient?: QueryClient | (() => QueryClient) | undefined;
  readonly overrides?:
    | {
        readonly mutations?: MutationOptionsOverride | undefined;
      }
    | undefined;
} & KeyPrefixOptions<TFeatureFlags>;

/**
 * Options of {@link createRpcOptionsProxy}: the Promise client plus
 * {@link RpcOptionsProxyOptionsBase}.
 *
 * @category options
 * @since 0.1.0
 */
export type RpcOptionsProxyOptions<
  R extends Router.Any,
  TFeatureFlags extends FeatureFlags = DefaultFeatureFlags,
> = RpcOptionsProxyOptionsBase<TFeatureFlags> & {
  /** The Promise client (`createClient(router, { link })`). */
  readonly client: Client<R>;
};

const procedureUtils: Readonly<Record<string, ProcedureKind>> = {
  queryOptions: 'query',
  infiniteQueryOptions: 'query',
  mutationOptions: 'mutation',
  subscriptionOptions: 'subscription',
};

const kindHint: Readonly<Record<ProcedureKind, string>> = {
  query: 'queryOptions()/infiniteQueryOptions()',
  mutation: 'mutationOptions()',
  subscription: 'subscriptionOptions()',
};

/**
 * A recursive proxy that calls `callback(path, args)` when a path is called. Keys resolve with the
 * router proxies' shared policy (`Router.childPath`).
 */
const createRecursiveProxy = (
  router: Router.Any,
  callback: (path: ReadonlyArray<string>, args: ReadonlyArray<unknown>) => unknown,
): unknown => {
  const make = (path: ReadonlyArray<string>): unknown =>
    new Proxy(() => undefined, {
      get: (_target, key) => {
        const next = Router.childPath(router, path, key);
        return next === undefined ? undefined : make(next);
      },
      apply: (_target, _this, args: ReadonlyArray<unknown>) => callback(path, args),
    });
  return make([]);
};

/**
 * Creates the options proxy of a router from a Promise client (tRPC's `createTRPCOptionsProxy`).
 *
 * **When to use**
 *
 * Use outside of React context: route loaders, server components, prefetching before
 * `dehydrate`, scripts and tests. In components, prefer `useRpc()` from `createRpcContext`,
 * which returns the same proxy.
 *
 * **Details**
 *
 * - The router comes from `client.$router`, so a client of a router service
 *   (`createClient(AppRouter, ...)`) gives `RpcOptionsProxy<Router.Of<typeof AppRouter>>`.
 * - The router is read from the client (`client.$router`), so only the client is required.
 * - `queryOptions` passes TanStack's `AbortSignal` to the call: cancelling a query (or unmounting
 *   its last observer) interrupts the server handler.
 * - `queryClient` is required by `overrides.mutations`; with it, `mutationOptions` also runs the
 *   `onSuccess` of `queryClient.setMutationDefaults`.
 * - With `{ keyPrefix: true }` feature flags, every query and mutation key starts with
 *   `[keyPrefix]`.
 *
 * **Gotchas**
 *
 * - Calling the wrong helper for a procedure kind (`queryOptions` on a mutation) or a path that is
 *   not a procedure throws an `Error` at call time.
 * - tRPC's `router` + `ctx` server mode does not exist: on the server, create a client over
 *   `localLink({ handlers })` from `@rpc-effect/client`, which calls the handlers in-process.
 * - The request option is `rpc: { headers }` (tRPC: `trpc: { context }`), and the metadata on each
 *   result is `.rpc.path` (tRPC: `.trpc.path`).
 *
 * **Example** (Prefetching in a loader, then invalidating by path)
 *
 * ```ts
 * import { createClient, httpLink } from '@rpc-effect/client';
 * import { mutation, query, Router } from '@rpc-effect/core';
 * import { Schema } from 'effect';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 * const appRouter = Router.make({
 *   post: {
 *     byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }),
 *     create: mutation({ payload: { title: Schema.String }, success: Post }),
 *   },
 * });
 * type AppRouter = typeof appRouter;
 * import { createRpcOptionsProxy } from '@rpc-effect/tanstack-react-query';
 * import { QueryClient } from '@tanstack/react-query';
 *
 * const client = createClient(appRouter, { link: httpLink({ url: 'http://localhost:3000/rpc' }) });
 * const queryClient = new QueryClient();
 * const rpc = createRpcOptionsProxy({ client, queryClient });
 *
 * export async function loadPost(id: number) {
 *   // Throws the ClientError (e.g. a PostNotFound instance) when the query fails.
 *   const post = await queryClient.fetchQuery(rpc.post.byId.queryOptions({ id }));
 *   // Typed through the data-tagged key: Post | undefined.
 *   const cached = queryClient.getQueryData(rpc.post.byId.queryKey({ id }));
 *   return { post, cached };
 * }
 *
 * export const refreshPosts = () => queryClient.invalidateQueries(rpc.post.pathFilter());
 * ```
 *
 * **Example** (Invalidate everything after any mutation)
 *
 * ```ts
 * import type { Client } from '@rpc-effect/client';
 * import { mutation, query, Router } from '@rpc-effect/core';
 * import { Schema } from 'effect';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 * const appRouter = Router.make({
 *   post: {
 *     byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }),
 *     create: mutation({ payload: { title: Schema.String }, success: Post }),
 *   },
 * });
 * type AppRouter = typeof appRouter;
 * import { createRpcOptionsProxy } from '@rpc-effect/tanstack-react-query';
 * import { QueryClient } from '@tanstack/react-query';
 *
 * declare const client: Client<AppRouter>;
 * const queryClient = new QueryClient();
 *
 * const rpc = createRpcOptionsProxy({
 *   client,
 *   queryClient,
 *   overrides: {
 *     mutations: {
 *       onSuccess: async ({ originalFn, queryClient }) => {
 *         await originalFn(); // the onSuccess given to mutationOptions
 *         await queryClient.invalidateQueries();
 *       },
 *     },
 *   },
 * });
 *
 * export const createPostOptions = rpc.post.create.mutationOptions();
 * ```
 *
 * @see createRpcContext
 * @see {@link RpcOptionsProxy}
 * @category constructors
 * @since 0.1.0
 */
export const createRpcOptionsProxy = <
  R extends Router.Any,
  TFeatureFlags extends FeatureFlags = DefaultFeatureFlags,
>(
  opts: RpcOptionsProxyOptions<R, TFeatureFlags>,
): RpcOptionsProxy<R, TFeatureFlags> => {
  const { client } = opts;
  const prefix = opts.keyPrefix;
  const router: Router.Any = client.$router;

  const call: ProcedureCaller = (path, input, callOptions) => {
    let node: unknown = client;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `path` comes from the router-driven proxy, so every segment is a namespace of `client`
    for (const segment of path) node = (node as Record<string, unknown>)[segment];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the full path names a procedure, which the Promise client exposes as a function
    return (node as (input: unknown, options: unknown) => unknown)(input, callOptions);
  };

  const assertKind = (path: ReadonlyArray<string>, util: string, kind: ProcedureKind): void => {
    const tag = path.join('.');
    const info = router.procedures.get(tag);
    if (info === undefined) {
      throw new Error(`${util}(): "${tag}" is not a procedure of the router`);
    }
    if (info.kind !== kind) {
      throw new Error(`${util}(): "${tag}" is a ${info.kind}; use ${kindHint[info.kind]} instead`);
    }
  };

  const queryClient = (): QueryClient | undefined =>
    opts.queryClient === undefined ? undefined : unwrapLazyArg(opts.queryClient);

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the proxy resolves paths from `client.$router` (an `R`) and dispatches on the util name, so it implements `RpcOptionsProxy<R>`
  return createRecursiveProxy(router, (fullPath, args) => {
    const path = fullPath.slice(0, -1);
    const util: string | undefined = fullPath[fullPath.length - 1];
    const [arg1, arg2] = args as ReadonlyArray<any>;
    const kind = util === undefined ? undefined : procedureUtils[util];
    if (util !== undefined && kind !== undefined) assertKind(path, util, kind);
    switch (util) {
      case 'pathKey':
        return getQueryKeyInternal({ path, type: 'any', prefix });
      case 'pathFilter':
        return { ...arg1, queryKey: getQueryKeyInternal({ path, type: 'any', prefix }) };
      case 'queryOptions':
        return rpcQueryOptions({
          input: arg1,
          opts: arg2,
          path,
          call,
          queryKey: getQueryKeyInternal({ path, input: arg1, type: 'query', prefix }),
        });
      case 'queryKey':
        return getQueryKeyInternal({ path, input: arg1, type: 'query', prefix });
      case 'queryFilter':
        return {
          ...arg2,
          queryKey: getQueryKeyInternal({ path, input: arg1, type: 'query', prefix }),
        };
      case 'infiniteQueryOptions':
        return rpcInfiniteQueryOptions({
          input: arg1,
          opts: arg2,
          path,
          call,
          queryKey: getQueryKeyInternal({ path, input: arg1, type: 'infinite', prefix }),
        });
      case 'infiniteQueryKey':
        return getQueryKeyInternal({ path, input: arg1, type: 'infinite', prefix });
      case 'infiniteQueryFilter':
        return {
          ...arg2,
          queryKey: getQueryKeyInternal({ path, input: arg1, type: 'infinite', prefix }),
        };
      case 'mutationOptions':
        return rpcMutationOptions({
          opts: arg1,
          path,
          prefix,
          call,
          queryClient: queryClient(),
          overrides: opts.overrides?.mutations,
        });
      case 'mutationKey':
        return getMutationKeyInternal({ path, prefix });
      case 'subscriptionOptions':
        return rpcSubscriptionOptions({
          client,
          opts: arg2,
          path,
          input: arg1,
          call,
          queryKey: getQueryKeyInternal({ path, input: arg1, type: 'any', prefix }),
        });
      default:
        throw new Error(
          `"${fullPath.join('.')}" is not callable; call one of the option helpers (queryOptions, mutationOptions, pathKey, ...)`,
        );
    }
  }) as RpcOptionsProxy<R, TFeatureFlags>;
};
