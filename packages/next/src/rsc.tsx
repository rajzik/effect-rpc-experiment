import { createClient, localLink } from '@effect-trpc/client';
import type { Client, HeadersOption } from '@effect-trpc/client';
import type { Router } from '@effect-trpc/core';
import { createCaller } from '@effect-trpc/server';
import type { Caller } from '@effect-trpc/server';
import {
  createHydrationHelpers,
  createRpcOptionsProxy,
  dehydrate,
  QueryKeys,
} from '@effect-trpc/tanstack-react-query';
import type {
  DefaultFeatureFlags,
  RpcDehydrateOptions,
  RpcOptionsProxy,
} from '@effect-trpc/tanstack-react-query';
import type { DehydratedState, QueryClient } from '@tanstack/react-query';
import { Layer } from 'effect';
import * as React from 'react';
import { makeQueryClient } from './queryClient.js';

/** A memoizer: `React.cache` in server components (one value per request). */
export type CacheFn = <T>(fn: () => T) => () => T;

/** Runs the router in-process: no HTTP hop between server components and handlers. */
export interface RscHandlersSource<R extends Router.Any> {
  /** Layer providing every handler of the router and its server middleware. */
  readonly handlers: Layer.Layer<Caller.Requirements<R>, unknown>;
  /**
   * Rpc headers sent with every in-process call, a function is evaluated per call. Forward the
   * incoming request's headers for middleware: `headers: async () => await headers()`.
   */
  readonly headers?: HeadersOption | undefined;
  /** Client-side middleware layers (for middleware declared with `requiredForClient: true`). */
  readonly middleware?: Layer.Layer<never, unknown> | undefined;
}

/** Calls the router through an existing client (e.g. `httpLink` to another service). */
export interface RscClientSource<R extends Router.Any> {
  readonly client: Client<R>;
}

/** The component rendering the dehydrated state on the client. */
export type HydrationBoundaryComponent = React.ComponentType<{
  readonly state: DehydratedState;
  readonly children?: React.ReactNode;
}>;

/** Options of {@link createRscHelpers}. */
export interface RscHelpersOptions<P extends string | undefined = undefined> {
  /** Creates the per-request query client. Defaults to {@link makeQueryClient}. */
  readonly makeQueryClient?: (() => QueryClient) | undefined;
  /**
   * Memoizes `makeQueryClient` per request. Defaults to `React.cache`, which only memoizes inside
   * a React Server Components render (elsewhere every call creates a new client). Inject your
   * own scope in tests.
   */
  readonly cache?: CacheFn | undefined;
  /** Query key prefix of the options proxy (must match the client provider's `keyPrefix`). */
  readonly keyPrefix?: P;
  /**
   * The client component that decodes and hydrates the state. In a real App Router app pass the
   * `HydrationBoundary` exported by your `'use client'` module (see `createNextRpcClient`): a
   * server component can only render client components that come from a `'use client'` module.
   * Defaults to the effect-trpc `HydrationBoundary` of the router (fine outside RSC, e.g. tests).
   */
  readonly HydrationBoundary?: HydrationBoundaryComponent | undefined;
  /** Options passed to the Schema-aware `dehydrate`. */
  readonly dehydrateOptions?: RpcDehydrateOptions | undefined;
}

/** Feature flags of the options proxy for a key prefix option `P`. */
export type PrefixFlags<P extends string | undefined> = [P] extends [string]
  ? { readonly keyPrefix: true }
  : DefaultFeatureFlags;

/** Options accepted by `prefetch`: anything with a query key (query or infinite query options). */
export interface PrefetchableOptions {
  readonly queryKey: ReadonlyArray<unknown>;
}

/** What {@link createRscHelpers} returns (tRPC's `trpc/server.tsx`). */
export interface RscHelpers<R extends Router.Any, P extends string | undefined = undefined> {
  /** The query client of the current request (memoized with `cache`). */
  readonly getQueryClient: () => QueryClient;
  /** The options proxy, bound to `getQueryClient` (tRPC's `createTRPCOptionsProxy`). */
  readonly rpc: RpcOptionsProxy<R, PrefixFlags<P>>;
  /** The Promise client the options proxy calls. */
  readonly client: Client<R>;
  /**
   * Renders `HydrationBoundary` with the request's query client dehydrated (Schema-encoded), so
   * client components find the prefetched data as class instances.
   */
  readonly HydrateClient: React.FC<{ readonly children?: React.ReactNode }>;
  /**
   * Starts prefetching into the request's query client without awaiting it
   * (`prefetchInfiniteQuery` for infinite query options, `prefetchQuery` otherwise).
   */
  readonly prefetch: (options: PrefetchableOptions) => void;
  /** The Schema-aware dehydrated state of the request's query client. */
  readonly dehydrate: () => DehydratedState;
}

/** {@link RscHelpers} for in-process handlers, plus a direct caller. */
export interface RscHelpersWithCaller<
  R extends Router.Any,
  P extends string | undefined = undefined,
> extends RscHelpers<R, P> {
  /**
   * In-process caller (tRPC's `createCaller`) for reading data directly in a server component
   * without the query cache: `await caller.$promise.post.byId({ id })`.
   */
  readonly caller: Caller<R>;
}

/** `React.cache` exists since React 19 (it is missing from React 18's types and runtime). */
const reactCache = (React as { readonly cache?: CacheFn }).cache;

const isPrefetchInfinite = (queryKey: ReadonlyArray<unknown>): boolean =>
  QueryKeys.parseQueryKey(queryKey)?.type === 'infinite';

/**
 * Server-component helpers for the App Router + TanStack Query (tRPC's `trpc/server.tsx`):
 *
 * ```tsx
 * // trpc/server.tsx
 * import 'server-only';
 * export const { getQueryClient, rpc, HydrateClient, prefetch, caller } = createRscHelpers(
 *   appRouter,
 *   { handlers: HandlersLive },
 *   { HydrationBoundary },
 * );
 * ```
 *
 * With `{ handlers }` the router runs in-process (`localLink` — no HTTP hop, no serialization);
 * with `{ client }` the given client is used. `getQueryClient` is `cache(makeQueryClient)`: one
 * query client per request. `HydrateClient` dehydrates it with the procedures' schemas.
 */
export function createRscHelpers<
  R extends Router.Any,
  const P extends string | undefined = undefined,
>(
  router: R,
  source: RscHandlersSource<R>,
  options?: RscHelpersOptions<P>,
): RscHelpersWithCaller<R, P>;
export function createRscHelpers<
  R extends Router.Any,
  const P extends string | undefined = undefined,
>(router: R, source: RscClientSource<R>, options?: RscHelpersOptions<P>): RscHelpers<R, P>;
export function createRscHelpers<
  R extends Router.Any,
  const P extends string | undefined = undefined,
>(
  router: R,
  source: RscHandlersSource<R> | RscClientSource<R>,
  options: RscHelpersOptions<P> = {},
): RscHelpers<R, P> | RscHelpersWithCaller<R, P> {
  // `React.cache` exists since React 19; without it every call creates a new query client.
  const cache: CacheFn = options.cache ?? reactCache ?? ((fn) => () => fn());
  const getQueryClient = cache(options.makeQueryClient ?? (() => makeQueryClient()));

  let caller: Caller<R> | undefined;
  let client: Client<R>;
  if ('client' in source) {
    client = source.client;
  } else {
    client = createClient(router, {
      link: localLink({ handlers: source.handlers }),
      ...(source.headers !== undefined && { headers: source.headers }),
      ...(source.middleware !== undefined && { middleware: source.middleware }),
    });
    const handlers =
      source.middleware === undefined
        ? source.handlers
        : Layer.merge(source.handlers, source.middleware);
    caller = createCaller(router, {
      handlers,
    });
  }

  const rpc = createRpcOptionsProxy<R, PrefixFlags<P>>({
    client,
    queryClient: getQueryClient,
    ...(options.keyPrefix !== undefined && { keyPrefix: options.keyPrefix }),
  } as unknown as Parameters<typeof createRpcOptionsProxy<R, PrefixFlags<P>>>[0]);

  const Boundary: HydrationBoundaryComponent =
    options.HydrationBoundary ?? createHydrationHelpers(router).HydrationBoundary;

  const dehydrateRequest = (): DehydratedState =>
    dehydrate(router, getQueryClient(), options.dehydrateOptions);

  const HydrateClient: React.FC<{ readonly children?: React.ReactNode }> = ({ children }) => (
    <Boundary state={dehydrateRequest()}>{children}</Boundary>
  );
  HydrateClient.displayName = 'HydrateClient';

  const prefetch = (prefetchOptions: PrefetchableOptions): void => {
    const queryClient = getQueryClient();
    if (isPrefetchInfinite(prefetchOptions.queryKey)) {
      void queryClient.prefetchInfiniteQuery(prefetchOptions as never);
    } else {
      void queryClient.prefetchQuery(prefetchOptions);
    }
  };

  const helpers: RscHelpers<R, P> = {
    getQueryClient,
    rpc,
    client,
    HydrateClient,
    prefetch,
    dehydrate: dehydrateRequest,
  };
  return caller === undefined ? helpers : { ...helpers, caller };
}
