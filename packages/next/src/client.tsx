import { createClient, httpLink } from '@effect-trpc/client';
import type { Client, HeadersOption, SerializationOption } from '@effect-trpc/client';
import type { Router } from '@effect-trpc/core';
import { createHydrationHelpers, createRpcContext } from '@effect-trpc/tanstack-react-query';
import type { RpcHydrationBoundaryProps, RpcOptionsProxy } from '@effect-trpc/tanstack-react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { Layer } from 'effect';
import * as React from 'react';
import { makeQueryClient } from './queryClient.js';

const isServer = (): boolean => typeof window === 'undefined';

/**
 * The origin the app is served from (tRPC's `getBaseUrl`): `window.location.origin` in the
 * browser; on the server `https://$VERCEL_URL` on Vercel, else `http://localhost:$PORT` (port
 * 3000 by default). `httpLink` needs an absolute url, also during SSR of client components.
 */
export const getBaseUrl = (): string => {
  if (!isServer()) return window.location.origin;
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  if (env?.['VERCEL_URL'] !== undefined && env['VERCEL_URL'] !== '') {
    return `https://${env['VERCEL_URL']}`;
  }
  return `http://localhost:${env?.['PORT'] ?? '3000'}`;
};

/** Options of {@link createNextRpcClient}. */
export interface NextRpcClientOptions {
  /** Url of the route handler; relative urls resolve against `getBaseUrl()`. Default `/api/rpc`. */
  readonly url?: string | URL | undefined;
  /** Headers of every request (a function is evaluated per request). */
  readonly headers?: HeadersOption | undefined;
  /** Wire format, must match `createRouteHandler`. Default `"ndjson"`. */
  readonly serialization?: SerializationOption | undefined;
  /** Custom `fetch` (tests, polyfills, ...). */
  readonly fetch?: typeof globalThis.fetch | undefined;
  /** Client-side middleware layers (for middleware declared with `requiredForClient: true`). */
  readonly middleware?: Layer.Layer<never, unknown> | undefined;
  /** Creates query clients. Defaults to {@link makeQueryClient}. */
  readonly makeQueryClient?: (() => QueryClient) | undefined;
}

/** Props of the `RpcProvider` of {@link createNextRpcClient}. */
export interface NextRpcProviderProps {
  readonly children?: React.ReactNode;
  /** Use this query client instead of `getQueryClient()`. */
  readonly queryClient?: QueryClient | undefined;
}

/** What {@link createNextRpcClient} returns (tRPC's `trpc/client.tsx`). */
export interface NextRpcClient<R extends Router.Any> {
  /**
   * Provides a `QueryClient` (`getQueryClient()`) and an `httpLink` client (created once per
   * provider) to TanStack Query and to `useRpc` / `useRpcClient`.
   */
  readonly RpcProvider: React.FC<NextRpcProviderProps>;
  /** The options proxy: `useQuery(useRpc().post.byId.queryOptions({ id }))`. */
  readonly useRpc: () => RpcOptionsProxy<R>;
  /** The Promise client. */
  readonly useRpcClient: () => Client<R>;
  /**
   * The Schema-aware `HydrationBoundary` of the router. Pass it to `createRscHelpers` so that
   * `HydrateClient` renders it as a client component.
   */
  readonly HydrationBoundary: React.FC<RpcHydrationBoundaryProps>;
  /**
   * A new query client per call on the server (one per SSR request), a singleton in the browser
   * (so React suspending during the initial render does not throw the cache away).
   */
  readonly getQueryClient: () => QueryClient;
  /** Creates a Promise client over `httpLink` with these options. */
  readonly createClient: () => Client<R>;
}

/**
 * The client half of an App Router integration (tRPC's `trpc/client.tsx`). Call it in a
 * `'use client'` module:
 *
 * ```tsx
 * 'use client';
 * export const { RpcProvider, useRpc, useRpcClient, HydrationBoundary } =
 *   createNextRpcClient(appRouter, { url: '/api/rpc' });
 * ```
 *
 * Unlike tRPC the router value (its schemas) is needed on the client: results are decoded to
 * class instances with it.
 */
export const createNextRpcClient = <R extends Router.Any>(
  router: R,
  options: NextRpcClientOptions = {},
): NextRpcClient<R> => {
  const context = createRpcContext<R>();
  const { HydrationBoundary } = createHydrationHelpers(router);
  const make = options.makeQueryClient ?? (() => makeQueryClient());
  let browserQueryClient: QueryClient | undefined;

  const getQueryClient = (): QueryClient => {
    if (isServer()) return make();
    browserQueryClient ??= make();
    return browserQueryClient;
  };

  const newClient = (): Client<R> =>
    createClient(router, {
      link: httpLink({
        url: new URL(options.url ?? '/api/rpc', getBaseUrl()),
        ...(options.serialization !== undefined && { serialization: options.serialization }),
        ...(options.fetch !== undefined && { fetch: options.fetch }),
      }),
      ...(options.headers !== undefined && { headers: options.headers }),
      ...(options.middleware !== undefined && { middleware: options.middleware }),
    });

  const RpcProvider: React.FC<NextRpcProviderProps> = (props) => {
    const [ownQueryClient] = React.useState(() => props.queryClient ?? getQueryClient());
    const queryClient = props.queryClient ?? ownQueryClient;
    const [client] = React.useState(newClient);
    return (
      <QueryClientProvider client={queryClient}>
        <context.RpcProvider client={client} queryClient={queryClient}>
          {props.children}
        </context.RpcProvider>
      </QueryClientProvider>
    );
  };
  RpcProvider.displayName = 'NextRpcProvider';

  return {
    RpcProvider,
    useRpc: context.useRpc,
    useRpcClient: context.useRpcClient,
    HydrationBoundary,
    getQueryClient,
    createClient: newClient,
  };
};
