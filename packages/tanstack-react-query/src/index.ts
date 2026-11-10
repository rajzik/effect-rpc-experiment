/**
 * TanStack React Query integration for effect-trpc routers: a port of `@trpc/tanstack-react-query`.
 *
 * `createRpcContext` / `createRpcOptionsProxy` give a typed options proxy that mirrors the router
 * and produces plain TanStack options (`useQuery(rpc.post.byId.queryOptions({ id }))`), with
 * `error` typed as `ClientError<E>` from `@rpc-effect/core`. `useSubscription` consumes
 * subscription procedures, and `createHydrationHelpers` provides schema-aware SSR hydration. Calls
 * go through the Promise client of `@rpc-effect/client`.
 *
 * @since 0.1.0
 */
export { skipToken } from '@tanstack/react-query';
export type { SkipToken } from '@tanstack/react-query';
export { createRpcContext } from './Context.js';
export type { CreateRpcContextResult, RpcProviderProps } from './Context.js';
export { createRpcOptionsProxy } from './createOptionsProxy.js';
export type {
  DecoratedRouterRecord,
  DecorateInfiniteQueryProcedure,
  DecorateMutationProcedure,
  DecorateProcedure,
  DecorateQueryProcedure,
  DecorateRouterKeyable,
  DecorateSubscriptionProcedure,
  inferProxyError,
  inferProxyInput,
  inferProxyOutput,
  RpcOptionsProxy,
  RpcOptionsProxyOptions,
  RpcOptionsProxyOptionsBase,
} from './createOptionsProxy.js';
export { createHydrationHelpers, dehydrate, hydrate } from './Hydration.js';
export type {
  HydrationHelpers,
  HydrationHelpersOptions,
  RpcDehydrateOptions,
  RpcHydrateOptions,
  RpcHydrationBoundaryProps,
} from './Hydration.js';
export type { RpcInfiniteQueryOptions } from './infiniteQueryOptions.js';
export * as QueryKeys from './internals/keys.js';
export {
  getMutationKeyInternal as getMutationKey,
  getQueryKeyInternal as getQueryKey,
  readQueryKey,
} from './internals/keys.js';
export type {
  AnyRpcMutationKey,
  AnyRpcQueryKey,
  DefaultFeatureFlags,
  ExtractCursorType,
  FeatureFlags,
  KeyPrefixOptions,
  OptionalCursorInput,
  QueryType,
  ResolverDef,
  ResolverDefOf,
  RpcInfiniteData,
  RpcMutationKey,
  RpcMutationKeyWithoutPrefix,
  RpcMutationKeyWithPrefix,
  RpcOptionsResult,
  RpcPageParam,
  RpcQueryBaseOptions,
  RpcQueryKey,
  RpcQueryKeyWithoutPrefix,
  RpcQueryKeyWithPrefix,
  RpcRequestOptions,
} from './internals/types.js';
export type {
  MutationOptionsOverride,
  RpcMutationOptions,
  RpcMutationOptionsIn,
  RpcMutationOptionsOut,
} from './mutationOptions.js';
export type { RpcQueryOptions } from './queryOptions.js';
export type {
  RpcConnectionState,
  RpcSubscribeOptions,
  RpcSubscriptionCallbacks,
  RpcSubscriptionOptions,
  RpcSubscriptionOptionsIn,
  RpcSubscriptionOptionsOut,
} from './subscriptionOptions.js';
export { useSubscription } from './useSubscription.js';
export type {
  RpcSubscriptionBaseResult,
  RpcSubscriptionConnectingResult,
  RpcSubscriptionErrorResult,
  RpcSubscriptionIdleResult,
  RpcSubscriptionPendingResult,
  RpcSubscriptionResult,
  RpcSubscriptionStatus,
} from './useSubscription.js';
