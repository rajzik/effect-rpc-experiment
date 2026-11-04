/**
 * TanStack Query helpers for TanStack Start: loader options proxy, React context and
 * Schema-aware SSR hydration.
 *
 * {@link createStartHelpers} binds the `@effect-trpc/tanstack-react-query` options proxy to a
 * router-context `QueryClient` (`rpc(context.queryClient)` in loaders) and creates the
 * `RpcProvider` / `useRpc` context. {@link createStartHydration} plugs Schema-aware `dehydrate` /
 * `hydrate` into TanStack Router's `createRouter({ dehydrate, hydrate })`, so `Schema.Class`
 * instances, `Date`s and `TaggedError`s survive the SSR → browser hand-off that Start's own
 * serializer would flatten. Works on both sides.
 *
 * @since 0.1.0
 */
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

/**
 * Schema-aware SSR hydration for a TanStack Start router; see {@link createStartHydration}.
 *
 * @category hydration
 * @since 0.1.0
 */
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

/**
 * The dehydrated router payload of {@link StartHydration.routerOptions}.
 *
 * @category hydration
 * @since 0.1.0
 */
export interface StartDehydratedQueries {
  /** `JSON.stringify` of the Schema-encoded `DehydratedState`. */
  readonly queryState: string;
}

/**
 * The `createRouter` options returned by {@link StartHydration.routerOptions}.
 *
 * @category hydration
 * @since 0.1.0
 */
export interface StartRouterHydrationOptions {
  /** Server: Schema-encodes the `QueryClient` cache after the loaders ran. */
  readonly dehydrate: () => StartDehydratedQueries;
  /** Browser: decodes the payload into the same `QueryClient` before rendering. */
  readonly hydrate: (dehydrated: StartDehydratedQueries) => void;
}

/**
 * Creates Schema-aware `dehydrate` / `hydrate` for a router (thin wrapper over
 * `@effect-trpc/tanstack-react-query`'s hydration helpers). `Schema.Class` instances, `Date`s and
 * `TaggedError`s survive the server → browser trip.
 *
 * **When to use**
 *
 * Use it when you do not need `createStartHelpers` (which already exposes the same object as
 * `hydration`), or to call `dehydrate` / `hydrate` from your own SSR hooks.
 *
 * **Details**
 *
 * - `dehydrate(queryClient)` encodes each rpc query's data (and error) with its procedure's
 *   schema (`createdAt` → ISO string); queries with other keys pass through unchanged.
 * - `hydrate(queryClient, state)` decodes it back to instances: methods work, `Date` fields are
 *   `Date`s, a failed query's error is the `TaggedError`.
 * - `routerOptions(queryClient)` returns `createRouter`'s `dehydrate` / `hydrate` options; the
 *   payload is a JSON string (`{ queryState }`) so it passes the router's serializability check.
 *
 * **Gotchas**
 *
 * - Data returned from a loader goes through Start's serializer, not these schemas: `await`
 *   `ensureQueryData` / `prefetchQuery` in the loader instead of returning its result.
 * - Not tested with `@tanstack/react-router-ssr-query`; do not let rpc data go through both
 *   serializers.
 *
 * **Example** (src/router.tsx with the Schema-aware cache hand-off)
 *
 * ```tsx
 * // src/router.tsx — runs on the server and in the browser
 * import { query, Router } from '@effect-trpc/core';
 * import { createStartHydration } from '@effect-trpc/start';
 * import { QueryClient } from '@tanstack/react-query';
 * import { createRootRouteWithContext, createRouter } from '@tanstack/react-router';
 * import { Schema } from 'effect';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, createdAt: Schema.Date }) {}
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post }) },
 * });
 * // src/routeTree.gen.ts in a real app
 * const routeTree = createRootRouteWithContext<{ queryClient: QueryClient }>()({});
 *
 * const hydration = createStartHydration(appRouter);
 *
 * export function getRouter() {
 *   const queryClient = new QueryClient(); // one per request on the server
 *   return createRouter({
 *     routeTree,
 *     context: { queryClient },
 *     ...hydration.routerOptions(queryClient),
 *   });
 * }
 * ```
 *
 * @see {@link createStartHelpers}
 * @category hydration
 * @since 0.1.0
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

/**
 * Options of {@link createStartHelpers}: the `client` (required) and, with the
 * `{ keyPrefix: true }` flag, the required `keyPrefix`.
 *
 * @category options
 * @since 0.1.0
 */
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

/**
 * What {@link createStartHelpers} returns: `rpc` / `getRpc` for loaders, the context
 * (`RpcProvider`, `useRpc`, `useRpcClient`), the `client` and `hydration`.
 *
 * @see {@link createStartHelpers}
 * @category models
 * @since 0.1.0
 */
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
 * Creates everything a TanStack Start app needs to use a router with TanStack Query: the options
 * proxy for loaders (`rpc(queryClient)`), the React provider and hooks (`RpcProvider`, `useRpc`,
 * `useRpcClient`) and Schema-aware SSR hydration.
 *
 * **When to use**
 *
 * Call it once in `src/rpc/client.ts`, next to `createIsomorphicClient`, and import its exports
 * from `src/router.tsx` and routes. Use `@effect-trpc/tanstack-react-query` directly outside
 * TanStack Start.
 *
 * **Details**
 *
 * - `rpc(queryClient)` (alias `getRpc`) is the options proxy bound to that `QueryClient`,
 *   memoized per client. The same options work in loaders (server: in-process; client-side
 *   navigation: `httpLink`) and in components (`useRpc()`).
 * - Query data are class instances; query errors are `ClientError<E>`
 *   (`E | RpcDefect | RpcTransportError | RpcInterrupted`): `ensureQueryData` / `fetchQuery`
 *   reject with the `TaggedError` instance.
 * - `RpcProvider` needs the `client` and the router-context `queryClient` as props; render it
 *   in the router's `Wrap`, inside `QueryClientProvider`.
 * - `hydration` is {@link createStartHydration} of the router: spread
 *   `hydration.routerOptions(queryClient)` into `createRouter`.
 * - Pass the key prefix flag as second type argument to use `keyPrefix`:
 *   `createStartHelpers<AppRouter, { keyPrefix: true }>(appRouter, { client, keyPrefix: 'blog' })`;
 *   `RpcProvider` then requires the same `keyPrefix` prop.
 *
 * **Gotchas**
 *
 * - Create the `QueryClient` inside `getRouter()` (one per request on the server), never at
 *   module level.
 * - In loaders, `await` `ensureQueryData` / `prefetchQuery` instead of returning the data: loader
 *   return values go through Start's serializer, which does not know `Schema.Class`.
 * - During SSR an error thrown by a loader can lose its class on the way to `errorComponent`;
 *   on SSR'd pages prefer `prefetchQuery` (never throws; the encoded error is dehydrated) and read
 *   `query.error` in the component.
 *
 * **Example** (src/rpc/client.ts, src/router.tsx and a route with a loader)
 *
 * ```tsx
 * // src/rpc/client.ts + src/router.tsx + src/routes/posts.$postId.tsx (server and browser)
 * import { query, Router } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 * import { createIsomorphicClient, createStartHelpers } from '@effect-trpc/start';
 * import { QueryClient, QueryClientProvider, useSuspenseQuery } from '@tanstack/react-query';
 * import { createRootRouteWithContext, createRoute, createRouter } from '@tanstack/react-router';
 * import { Effect, Schema } from 'effect';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {
 *   shout(): string {
 *     return `${this.title.toUpperCase()}!`;
 *   }
 * }
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post }) },
 * });
 * const HandlersLive = Handlers.make(appRouter, {
 *   post: { byId: ({ id }) => Effect.succeed(new Post({ id, title: 'Hello' })) },
 * });
 *
 * // src/rpc/client.ts
 * const client = createIsomorphicClient(appRouter, {
 *   server: { handlers: HandlersLive },
 *   client: { url: '/api/rpc' },
 * });
 * const { rpc, RpcProvider, useRpc, hydration } = createStartHelpers(appRouter, { client });
 *
 * // src/routes/__root.tsx and src/routes/posts.$postId.tsx (file routes use createFileRoute)
 * const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({});
 * const postRoute = createRoute({
 *   getParentRoute: () => rootRoute,
 *   path: '/posts/$postId',
 *   // Await, do not return: the data reaches the browser through the Schema-encoded cache.
 *   loader: async ({ context, params }) => {
 *     await context.queryClient.ensureQueryData(
 *       rpc(context.queryClient).post.byId.queryOptions({ id: Number(params.postId) }),
 *     );
 *   },
 *   component: function PostPage() {
 *     const { postId } = postRoute.useParams();
 *     const { data: post } = useSuspenseQuery(
 *       useRpc().post.byId.queryOptions({ id: Number(postId) }),
 *     );
 *     return <h1>{post.shout()}</h1>; // a real Post instance, also after SSR hydration
 *   },
 * });
 *
 * // src/router.tsx
 * export function getRouter() {
 *   const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
 *   return createRouter({
 *     routeTree: rootRoute.addChildren([postRoute]),
 *     context: { queryClient },
 *     ...hydration.routerOptions(queryClient),
 *     Wrap: ({ children }) => (
 *       <QueryClientProvider client={queryClient}>
 *         <RpcProvider client={client} queryClient={queryClient}>
 *           {children}
 *         </RpcProvider>
 *       </QueryClientProvider>
 *     ),
 *   });
 * }
 * ```
 *
 * @see {@link createIsomorphicClient}
 * @see {@link createStartHydration}
 * @category constructors
 * @since 0.1.0
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
