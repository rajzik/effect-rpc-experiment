import type { Client } from '@effect-trpc/client';
import type { Router } from '@effect-trpc/core';
import type { QueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { createRpcOptionsProxy, type RpcOptionsProxy } from './createOptionsProxy.js';
import type { DefaultFeatureFlags, FeatureFlags, KeyPrefixOptions } from './internals/types.js';

/** Props of `RpcProvider`. `keyPrefix` is required exactly with `{ keyPrefix: true }` flags. */
export type RpcProviderProps<
  R extends Router.Any,
  TFeatureFlags extends FeatureFlags = DefaultFeatureFlags,
> = {
  readonly children?: React.ReactNode;
  readonly queryClient: QueryClient;
  readonly client: Client<R>;
} & KeyPrefixOptions<TFeatureFlags>;

/** The result of {@link createRpcContext}. */
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

/**
 * Creates a typed provider and hooks for a router (tRPC's `createTRPCContext`):
 *
 * ```tsx
 * export const { RpcProvider, useRpc, useRpcClient } = createRpcContext<AppRouter>();
 * ```
 *
 * Call it once per router (module scope). For several routers on one `QueryClient`, create one
 * context each with `{ keyPrefix: true }` and give every provider its own `keyPrefix`.
 */
export const createRpcContext = <
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
