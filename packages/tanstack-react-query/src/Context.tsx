/**
 * Creates the React context (provider + hooks) that hands a router's typed options proxy to
 * components.
 *
 * `createRpcContext<AppRouter>()` is the effect-trpc counterpart of tRPC's `createTRPCContext`: the
 * returned `RpcProvider` builds one {@link createRpcOptionsProxy} proxy per `client` /
 * `queryClient` / `keyPrefix`, and `useRpc()` returns it so components can call
 * `useQuery(rpc.post.byId.queryOptions(...))` with the plain TanStack hooks. The `client` is a
 * Promise client from `@effect-trpc/client` (`createClient(router, { link })`).
 *
 * @since 0.1.0
 */
import type { Client } from '@effect-trpc/client';
import type { Router } from '@effect-trpc/core';
import type { QueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { createRpcOptionsProxy, type RpcOptionsProxy } from './createOptionsProxy.js';
import type { DefaultFeatureFlags, FeatureFlags, KeyPrefixOptions } from './internals/types.js';

/**
 * Props of the `RpcProvider` returned by {@link createRpcContext}.
 *
 * **Details**
 *
 * - `client`: the Promise client (`createClient(router, { link })`). tRPC calls it `trpcClient`.
 * - `queryClient`: the same `QueryClient` you pass to `QueryClientProvider`. It is used for the
 *   mutation defaults / overrides of `mutationOptions`; `RpcProvider` does not render a
 *   `QueryClientProvider` itself.
 * - `keyPrefix`: required exactly when the context was created with `{ keyPrefix: true }` feature
 *   flags, and forbidden (`never`) otherwise.
 *
 * @see {@link createRpcContext}
 * @category components
 * @since 0.1.0
 */
export type RpcProviderProps<
  R extends Router.Any,
  TFeatureFlags extends FeatureFlags = DefaultFeatureFlags,
> = {
  readonly children?: React.ReactNode;
  readonly queryClient: QueryClient;
  readonly client: Client<R>;
} & KeyPrefixOptions<TFeatureFlags>;

/**
 * The provider and hooks returned by {@link createRpcContext}.
 *
 * **Details**
 *
 * - `useRpc()` and `useRpcClient()` throw when they are rendered outside of their `RpcProvider`.
 * - The proxy returned by `useRpc()` is memoized per `client` / `queryClient` / `keyPrefix`, so it
 *   is stable across renders and safe to use in effect dependency arrays.
 *
 * @see {@link createRpcContext}
 * @category models
 * @since 0.1.0
 */
export interface CreateRpcContextResult<
  R extends Router.Any,
  TFeatureFlags extends FeatureFlags = DefaultFeatureFlags,
> {
  /** Provides the client and the options proxy to `useRpc` / `useRpcClient`. */
  readonly RpcProvider: React.FC<RpcProviderProps<R, TFeatureFlags>>;
  /** The options proxy of the nearest `RpcProvider`. */
  readonly useRpc: () => RpcOptionsProxy<R, TFeatureFlags>;
  /** The Promise client of the nearest `RpcProvider`. */
  readonly useRpcClient: () => Client<R>;
}

/** `createRpcContext` for a router type (both overloads: a router service maps to `Router.Of<X>`). */
const createRpcContextFor = <
  R extends Router.Any,
  TFeatureFlags extends FeatureFlags = DefaultFeatureFlags,
>(): CreateRpcContextResult<R, TFeatureFlags> => {
  const ClientContext = React.createContext<Client<R> | null>(null);
  const ProxyContext = React.createContext<RpcOptionsProxy<R, TFeatureFlags> | null>(null);

  const RpcProvider: React.FC<RpcProviderProps<R, TFeatureFlags>> = (props) => {
    const { client, queryClient } = props;
    const keyPrefix = props.keyPrefix;
    const value = React.useMemo(
      () =>
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `RpcProviderProps` already requires `keyPrefix` exactly when `TFeatureFlags` does; only the generic flag check is erased
        createRpcOptionsProxy<R, FeatureFlags>({
          client,
          queryClient,
          ...(keyPrefix !== undefined && { keyPrefix }),
        } as Parameters<typeof createRpcOptionsProxy<R, FeatureFlags>>[0]) as RpcOptionsProxy<
          R,
          TFeatureFlags
        >,
      [client, queryClient, keyPrefix],
    );
    return (
      <ClientContext.Provider value={client}>
        <ProxyContext.Provider value={value}>{props.children}</ProxyContext.Provider>
      </ClientContext.Provider>
    );
  };
  RpcProvider.displayName = 'RpcProvider';

  const useRpc = (): RpcOptionsProxy<R, TFeatureFlags> => {
    const proxy = React.useContext(ProxyContext);
    if (proxy === null) throw new Error('useRpc() can only be used inside of an <RpcProvider>');
    return proxy;
  };

  const useRpcClient = (): Client<R> => {
    const client = React.useContext(ClientContext);
    if (client === null) {
      throw new Error('useRpcClient() can only be used inside of an <RpcProvider>');
    }
    return client;
  };

  return { RpcProvider, useRpc, useRpcClient };
};

/**
 * Creates a typed `RpcProvider` plus the `useRpc` / `useRpcClient` hooks for one router (tRPC's
 * `createTRPCContext`).
 *
 * **When to use**
 *
 * Use in a React app: call it once per router at module scope, render `RpcProvider` inside
 * `QueryClientProvider`, and read the options proxy with `useRpc()` in components. Prefer
 * {@link createRpcOptionsProxy} outside of React (route loaders, server components, scripts), and
 * the `@effect-trpc/next` / `@effect-trpc/start` helpers when you use those frameworks.
 *
 * **Details**
 *
 * - `R` is a router type or a router service class: `createRpcContext<typeof AppRouter>()` is
 *   `createRpcContext<Router.Of<typeof AppRouter>>()`.
 * - The router type is the only type argument you must pass; the runtime router comes from the
 *   `client` given to `RpcProvider`.
 * - `useRpc()` returns an {@link RpcOptionsProxy}: `rpc.post.byId.queryOptions(...)`,
 *   `rpc.post.create.mutationOptions(...)`, `rpc.post.pathFilter()`, ...
 * - `useRpcClient()` returns the Promise client itself, for imperative calls
 *   (`await client.post.byId({ id })`).
 * - To share one `QueryClient` between several routers, create each context with
 *   `createRpcContext<Router, { keyPrefix: true }>()` and give every provider its own `keyPrefix`;
 *   keys then start with `[prefix]`.
 *
 * **Gotchas**
 *
 * - There are no tRPC-v10-style hooks (`rpc.post.byId.useQuery()`): pass the options to the
 *   TanStack hooks (`useQuery(rpc.post.byId.queryOptions(...))`).
 * - `RpcProvider` takes `client` (tRPC: `trpcClient`) and does not render a
 *   `QueryClientProvider`; wrap it in one with the same `queryClient`.
 * - Create the `QueryClient` and the client once per app (e.g. `useState(() => ...)`), not on
 *   every render: a new client makes a new proxy, and the old client is not disposed.
 *
 * **Example** (App provider and a query component)
 *
 * ```tsx
 * import { createClient, httpLink, RpcTransportError } from '@effect-trpc/client';
 * import { query, Router } from '@effect-trpc/core';
 * import { createRpcContext } from '@effect-trpc/tanstack-react-query';
 * import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
 * import { Schema } from 'effect';
 * import { useState, type ReactNode } from 'react';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * type AppRouter = typeof appRouter;
 *
 * // Module scope: one context per router.
 * export const { RpcProvider, useRpc, useRpcClient } = createRpcContext<AppRouter>();
 *
 * export function App({ children }: { children: ReactNode }) {
 *   const [queryClient] = useState(
 *     () =>
 *       new QueryClient({
 *         // Typed errors and defects do not change on retry; only retry network failures.
 *         defaultOptions: { queries: { retry: (n, e) => e instanceof RpcTransportError && n < 3 } },
 *       }),
 *   );
 *   const [client] = useState(() =>
 *     createClient(appRouter, { link: httpLink({ url: 'http://localhost:3000/rpc' }) }),
 *   );
 *   return (
 *     <QueryClientProvider client={queryClient}>
 *       <RpcProvider client={client} queryClient={queryClient}>
 *         {children}
 *       </RpcProvider>
 *     </QueryClientProvider>
 *   );
 * }
 *
 * export function PostTitle({ id }: { id: number }) {
 *   const rpc = useRpc();
 *   const post = useQuery(rpc.post.byId.queryOptions({ id }));
 *   if (post.error?._tag === 'PostNotFound') return <p>No post #{post.error.id}</p>;
 *   if (post.error) return <p>Something went wrong: {post.error.message}</p>;
 *   return <h1>{post.data?.title ?? 'Loading…'}</h1>;
 * }
 * ```
 *
 * **Example** (Two routers on one QueryClient with key prefixes)
 *
 * ```tsx
 * import type { Client } from '@effect-trpc/client';
 * import { query, Router } from '@effect-trpc/core';
 * import { createRpcContext } from '@effect-trpc/tanstack-react-query';
 * import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
 * import { Schema } from 'effect';
 * import type { ReactNode } from 'react';
 *
 * const billingRouter = Router.make({ list: query({ success: Schema.Array(Schema.String) }) });
 * const accountRouter = Router.make({ list: query({ success: Schema.Array(Schema.String) }) });
 * declare const billingClient: Client<typeof billingRouter>;
 * declare const accountClient: Client<typeof accountRouter>;
 *
 * const billing = createRpcContext<typeof billingRouter, { keyPrefix: true }>();
 * const account = createRpcContext<typeof accountRouter, { keyPrefix: true }>();
 * const queryClient = new QueryClient();
 *
 * // Keys become [["billing"], ["list"], { type: "query" }] and [["account"], ["list"], ...].
 * export const Providers = ({ children }: { children: ReactNode }) => (
 *   <QueryClientProvider client={queryClient}>
 *     <billing.RpcProvider client={billingClient} queryClient={queryClient} keyPrefix="billing">
 *       <account.RpcProvider client={accountClient} queryClient={queryClient} keyPrefix="account">
 *         {children}
 *       </account.RpcProvider>
 *     </billing.RpcProvider>
 *   </QueryClientProvider>
 * );
 * ```
 *
 * @see {@link createRpcOptionsProxy}
 * @see {@link RpcOptionsProxy}
 * @category constructors
 * @since 0.1.0
 */
export const createRpcContext: {
  <
    R extends Router.Any,
    TFeatureFlags extends FeatureFlags = DefaultFeatureFlags,
  >(): CreateRpcContextResult<R, TFeatureFlags>;
  <
    X extends Router.Input,
    TFeatureFlags extends FeatureFlags = DefaultFeatureFlags,
  >(): CreateRpcContextResult<Router.Of<X>, TFeatureFlags>;
} = createRpcContextFor;
