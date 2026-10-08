import type { Client } from '@effect-trpc/client';
import type { ProcedureDef, ProcedureKind, Router } from '@effect-trpc/core';
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
import {
  rpcSubscriptionOptions,
  type RpcSubscriptionOptions,
  type RpcSubscriptionOptionsIn,
} from './subscriptionOptions.js';

/** `pathKey()` / `pathFilter()`, available on every router node and procedure. */
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

/** The helpers of a query procedure with a `cursor` input. */
export interface DecorateInfiniteQueryProcedure<TDef extends ResolverDef> extends TypeHelper<TDef> {
  /** Options for `useInfiniteQuery`, `prefetchInfiniteQuery`, ... */
  infiniteQueryOptions: RpcInfiniteQueryOptions<TDef>;
  /** The (data-tagged) key of an infinite query (`type: "infinite"`, without the cursor). */
  infiniteQueryKey: (input?: Partial<TDef['input']>) => InfiniteQueryTag<TDef>;
  /** A query filter for infinite queries of this procedure. */
  infiniteQueryFilter: (
    input?: Partial<TDef['input']>,
    filters?: QueryFilters<InfiniteQueryTag<TDef>>,
  ) => WithRequired<QueryFilters<InfiniteQueryTag<TDef>>, 'queryKey'>;
}

/** The helpers of a query procedure. */
export interface DecorateQueryProcedure<TDef extends ResolverDef>
  extends TypeHelper<TDef>, DecorateRouterKeyable<TDef['featureFlags']> {
  /** Options for `useQuery`, `useSuspenseQuery`, `fetchQuery`, `prefetchQuery`, ... */
  queryOptions: RpcQueryOptions<TDef, TDef['featureFlags']>;
  /** The (data-tagged) query key: `[path, { input?, type: "query" }]`. */
  queryKey: (input?: Partial<TDef['input']>) => QueryTag<TDef>;
  /** A query filter for this procedure (all inputs when `input` is omitted). */
  queryFilter: (
    input?: Partial<TDef['input']>,
    filters?: QueryFilters<QueryTag<TDef>>,
  ) => WithRequired<QueryFilters<QueryTag<TDef>>, 'queryKey'>;
}

/** The helpers of a mutation procedure. */
export interface DecorateMutationProcedure<TDef extends ResolverDef> extends TypeHelper<TDef> {
  /** Options for `useMutation`. */
  mutationOptions: RpcMutationOptions<TDef, TDef['featureFlags']>;
  /** The mutation key: `[path]` (`[[prefix], path]` with a key prefix). */
  mutationKey: () => RpcMutationKey<TDef['featureFlags']['keyPrefix']>;
}

/** The helpers of a subscription procedure. */
export interface DecorateSubscriptionProcedure<TDef extends ResolverDef> extends TypeHelper<TDef> {
  /** Options for `useSubscription`. */
  subscriptionOptions: RpcSubscriptionOptions<TDef, TDef['featureFlags']>;
}

/** The helpers of a procedure, by kind. Infinite helpers need a `cursor` in the input. */
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

/** A router record decorated with the option helpers. */
export type DecoratedRouterRecord<Rec, TFeatureFlags extends FeatureFlags> = {
  readonly [K in keyof Rec]: Rec[K] extends ProcedureDef.Any
    ? DecorateProcedure<Rec[K]['kind'], ResolverDefOf<Rec[K], TFeatureFlags>>
    : DecoratedRouterRecord<RecordOf<Rec[K]>, TFeatureFlags> & DecorateRouterKeyable<TFeatureFlags>;
};

/**
 * The options proxy of a router (tRPC's `TRPCOptionsProxy`): mirrors the router, with
 * `queryOptions` / `mutationOptions` / `subscriptionOptions` / key helpers on each procedure and
 * `pathKey` / `pathFilter` on every node.
 */
export type RpcOptionsProxy<
  R extends Router.Any,
  TFeatureFlags extends FeatureFlags = DefaultFeatureFlags,
> = DecoratedRouterRecord<Router.Record<R>, TFeatureFlags> & DecorateRouterKeyable<TFeatureFlags>;

/** The input type of a decorated procedure: `inferProxyInput<typeof rpc.post.byId>`. */
export type inferProxyInput<
  TProcedure extends
    | DecorateQueryProcedure<any>
    | DecorateMutationProcedure<any>
    | DecorateSubscriptionProcedure<any>,
> = TProcedure['~types']['input'];

/** The output type of a decorated procedure: `inferProxyOutput<typeof rpc.post.byId>`. */
export type inferProxyOutput<
  TProcedure extends
    | DecorateQueryProcedure<any>
    | DecorateMutationProcedure<any>
    | DecorateSubscriptionProcedure<any>,
> = TProcedure['~types']['output'];

/** The error type (`ClientError<E>`) of a decorated procedure. */
export type inferProxyError<
  TProcedure extends
    | DecorateQueryProcedure<any>
    | DecorateMutationProcedure<any>
    | DecorateSubscriptionProcedure<any>,
> = TProcedure['~types']['error'];

/** Options of {@link createRpcOptionsProxy} besides the client. */
export type RpcOptionsProxyOptionsBase<TFeatureFlags extends FeatureFlags = DefaultFeatureFlags> = {
  /**
   * The query client (or a function returning it). Needed for the mutation `overrides` and for
   * `setMutationDefaults` to keep working with `mutationOptions`.
   */
  readonly queryClient?: QueryClient | (() => QueryClient) | undefined;
  readonly overrides?:
    | {
        readonly mutations?: MutationOptionsOverride | undefined;
      }
    | undefined;
} & KeyPrefixOptions<TFeatureFlags>;

/** Options of {@link createRpcOptionsProxy}. */
export type RpcOptionsProxyOptions<
  R extends Router.Any,
  TFeatureFlags extends FeatureFlags = DefaultFeatureFlags,
> = RpcOptionsProxyOptionsBase<TFeatureFlags> & {
  /** The Promise client (`createClient(router, { link })`). */
  readonly client: Client<R>;
};

type UtilName =
  | 'pathKey'
  | 'pathFilter'
  | 'queryOptions'
  | 'queryKey'
  | 'queryFilter'
  | 'infiniteQueryOptions'
  | 'infiniteQueryKey'
  | 'infiniteQueryFilter'
  | 'mutationOptions'
  | 'mutationKey'
  | 'subscriptionOptions';

const procedureUtils: Readonly<Record<string, ProcedureKind>> = {
  queryOptions: 'query',
  infiniteQueryOptions: 'query',
  mutationOptions: 'mutation',
  subscriptionOptions: 'subscription',
};

/** Keys that introspection (await, test matchers, React dev tools) probes on any object. */
const introspectionKeys: ReadonlySet<string> = new Set([
  'then',
  'toJSON',
  'asymmetricMatch',
  '$$typeof',
  'nodeType',
  'constructor',
  'prototype',
  'valueOf',
  'toString',
]);

const kindHint: Readonly<Record<ProcedureKind, string>> = {
  query: 'queryOptions()/infiniteQueryOptions()',
  mutation: 'mutationOptions()',
  subscription: 'subscriptionOptions()',
};

/** A recursive proxy that calls `callback(path, args)` when a path is called. */
const createRecursiveProxy = (
  callback: (path: ReadonlyArray<string>, args: ReadonlyArray<unknown>) => unknown,
): unknown => {
  const make = (path: ReadonlyArray<string>): unknown =>
    new Proxy(() => undefined, {
      get: (_target, key) => {
        if (typeof key !== 'string' || introspectionKeys.has(key)) return undefined;
        return make([...path, key]);
      },
      apply: (_target, _this, args: ReadonlyArray<unknown>) => callback(path, args),
    });
  return make([]);
};

/**
 * Creates the options proxy of a router from a Promise client (tRPC's `createTRPCOptionsProxy`).
 * Works without React (loaders, server components, plain TanStack Query):
 *
 * ```ts
 * const rpc = createRpcOptionsProxy({ client, queryClient });
 * await queryClient.prefetchQuery(rpc.post.byId.queryOptions({ id: 1 }));
 * ```
 *
 * Pass the key prefix flag as second type argument to use `keyPrefix`:
 * `createRpcOptionsProxy<AppRouter, { keyPrefix: true }>({ client, keyPrefix: 'billing' })`.
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
    for (const segment of path) node = (node as Record<string, unknown>)[segment];
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

  return createRecursiveProxy((fullPath, args) => {
    const path = fullPath.slice(0, -1);
    const util = fullPath[fullPath.length - 1] as UtilName | undefined;
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
          opts: arg2 as RpcSubscriptionOptionsIn<unknown, unknown> | undefined,
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
