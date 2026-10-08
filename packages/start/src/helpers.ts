import type { Client } from '@effect-trpc/client';
import type { Router } from '@effect-trpc/core';
import {
  createHydrationHelpers,
  createRpcContext,
  createRpcOptionsProxy,
} from '@effect-trpc/tanstack-react-query';
import type {
  CreateRpcContextResult,
  DefaultFeatureFlags,
  FeatureFlags,
  KeyPrefixOptions,
  RpcDehydrateOptions,
  RpcOptionsProxy,
} from '@effect-trpc/tanstack-react-query';
import type { DehydratedState, HydrateOptions, QueryClient } from '@tanstack/react-query';

/** Schema-aware SSR hydration for a TanStack Start router; see {@link createStartHydration}. */
export interface StartHydration {
  /**
   * TanStack's `dehydrate` with the data (and errors) of the router's queries encoded to JSON-safe
   * values by the procedures' schemas. Return it from the TanStack Router `dehydrate` option.
   */
  readonly dehydrate: (queryClient: QueryClient, options?: RpcDehydrateOptions) => DehydratedState;
  /**
   * TanStack's `hydrate`, decoding what `dehydrate` encoded back to class instances and typed
   * errors. Call it from the TanStack Router `hydrate` option.
   */
  readonly hydrate: (
    queryClient: QueryClient,
    state: DehydratedState | null | undefined,
    options?: HydrateOptions,
  ) => void;
  /**
   * The TanStack Router `dehydrate` / `hydrate` options for a `QueryClient`, to spread into
   * `createRouter({ ... })`: on the server the router dehydrates the query cache (Schema-encoded,
   * as a JSON string so it passes the router's serializability check) after the loaders ran; in
   * the browser it hydrates the same `QueryClient` before rendering.
   */
  readonly routerOptions: (queryClient: QueryClient) => StartRouterHydrationOptions;
}

/** The dehydrated router payload of {@link StartHydration.routerOptions}. */
export interface StartDehydratedQueries {
  /** `JSON.stringify` of the Schema-encoded `DehydratedState`. */
  readonly queryState: string;
}

/** The `createRouter` options returned by {@link StartHydration.routerOptions}. */
export interface StartRouterHydrationOptions {
  readonly dehydrate: () => StartDehydratedQueries;
  readonly hydrate: (dehydrated: StartDehydratedQueries) => void;
}

/**
 * Schema-aware `dehydrate` / `hydrate` for a router (thin wrapper over
 * `@effect-trpc/tanstack-react-query`'s hydration helpers). `Schema.Class` instances, `Date`s and
 * `TaggedError`s survive the server → browser trip:
 *
 * ```tsx
 * const hydration = createStartHydration(appRouter);
 * createRouter({ routeTree, context: { queryClient }, ...hydration.routerOptions(queryClient) });
 * ```
 */
export const createStartHydration = (router: Router.Any): StartHydration => {
  const { dehydrate, hydrate } = createHydrationHelpers(router);
  return {
    dehydrate,
    hydrate,
    routerOptions: (queryClient) => ({
      dehydrate: () => ({ queryState: JSON.stringify(dehydrate(queryClient)) }),
      hydrate: ({ queryState }) => {
        hydrate(queryClient, JSON.parse(queryState) as DehydratedState);
      },
    }),
  };
};

/** Options of {@link createStartHelpers}. */
export type StartHelpersOptions<
  R extends Router.Any,
  TFeatureFlags extends FeatureFlags = DefaultFeatureFlags,
> = {
  /**
   * The client the query functions call, typically `createIsomorphicClient(...)` (in-process on
   * the server, HTTP in the browser).
   */
  readonly client: Client<R>;
} & KeyPrefixOptions<TFeatureFlags>;

/** What {@link createStartHelpers} returns. */
export interface StartHelpers<
  R extends Router.Any,
  TFeatureFlags extends FeatureFlags = DefaultFeatureFlags,
> extends CreateRpcContextResult<R, TFeatureFlags> {
  /**
   * The options proxy bound to a `QueryClient` (memoized per client), for route loaders:
   * `context.queryClient.ensureQueryData(rpc(context.queryClient).post.byId.queryOptions({ id }))`.
   */
  readonly rpc: (queryClient: QueryClient) => RpcOptionsProxy<R, TFeatureFlags>;
  /** Alias of {@link StartHelpers.rpc}. */
  readonly getRpc: (queryClient: QueryClient) => RpcOptionsProxy<R, TFeatureFlags>;
  /** The client the helpers were created with. */
  readonly client: Client<R>;
  /** Schema-aware SSR hydration; see {@link createStartHydration}. */
  readonly hydration: StartHydration;
}

/**
 * Everything a TanStack Start app needs to use a router with TanStack Query: the options proxy
 * for loaders (`rpc(queryClient)`), the React provider and hooks (`RpcProvider`, `useRpc`,
 * `useRpcClient`) and Schema-aware SSR hydration.
 *
 * ```ts
 * export const { rpc, RpcProvider, useRpc, hydration } = createStartHelpers(appRouter, { client });
 * // src/routes/posts.$postId.tsx
 * loader: ({ context, params }) =>
 *   context.queryClient.ensureQueryData(
 *     rpc(context.queryClient).post.byId.queryOptions({ id: Number(params.postId) }),
 *   ),
 * ```
 *
 * Pass the key prefix flag as second type argument to use `keyPrefix`:
 * `createStartHelpers<AppRouter, { keyPrefix: true }>(appRouter, { client, keyPrefix: 'billing' })`.
 */
export const createStartHelpers = <
  R extends Router.Any,
  TFeatureFlags extends FeatureFlags = DefaultFeatureFlags,
>(
  router: R,
  options: StartHelpersOptions<R, TFeatureFlags>,
): StartHelpers<R, TFeatureFlags> => {
  const proxies = new WeakMap<QueryClient, RpcOptionsProxy<R, TFeatureFlags>>();
  const rpc = (queryClient: QueryClient): RpcOptionsProxy<R, TFeatureFlags> => {
    let proxy = proxies.get(queryClient);
    if (proxy === undefined) {
      proxy = createRpcOptionsProxy<R, TFeatureFlags>({
        client: options.client,
        queryClient,
        ...(options.keyPrefix !== undefined && { keyPrefix: options.keyPrefix }),
      } as unknown as Parameters<typeof createRpcOptionsProxy<R, TFeatureFlags>>[0]);
      proxies.set(queryClient, proxy);
    }
    return proxy;
  };
  const { RpcProvider, useRpc, useRpcClient } = createRpcContext<R, TFeatureFlags>();
  return {
    rpc,
    getRpc: rpc,
    client: options.client,
    RpcProvider,
    useRpc,
    useRpcClient,
    hydration: createStartHydration(router),
  };
};
