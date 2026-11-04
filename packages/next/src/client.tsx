/**
 * The client-component half of a Next.js App Router integration (tRPC's `trpc/client.tsx`).
 *
 * {@link createNextRpcClient} bundles a per-request / browser-singleton `QueryClient`, an
 * `httpLink` client pointed at the route handler of `createRouteHandler`, the
 * `@effect-trpc/tanstack-react-query` context (`useRpc`) and the router's Schema-aware
 * `HydrationBoundary`, which `createRscHelpers` renders to hand server-prefetched data to client
 * components. The package itself has no `'use client'` directive: call it from your own
 * `'use client'` module.
 *
 * @since 0.1.0
 */
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
 * Returns the origin the app is served from (tRPC's `getBaseUrl`).
 *
 * **When to use**
 *
 * Use it to build absolute urls to your own app from code that runs both in the browser and
 * during SSR. `createNextRpcClient` already resolves its relative `url` with it.
 *
 * **Details**
 *
 * - Browser: `window.location.origin`.
 * - Server: `https://$VERCEL_URL` when `VERCEL_URL` is set and non-empty, otherwise
 *   `http://localhost:$PORT` (`PORT` defaults to `3000`).
 *
 * **Gotchas**
 *
 * - `fetch` / `httpLink` on the server need absolute urls, also while client components render
 *   during SSR. Behind a proxy or on a non-Vercel host, the server-side guess can be wrong: pass
 *   an absolute `url` to `createNextRpcClient` instead.
 * - Unlike `@effect-trpc/start`'s `getBaseUrl`, it takes no options and ignores `PUBLIC_URL` /
 *   `URL`.
 *
 * **Example** (Absolute url of an app endpoint, client or server)
 *
 * ```ts
 * // lib/urls.ts — imported by server and client code
 * import { getBaseUrl } from '@effect-trpc/next';
 *
 * // `https://my-app.vercel.app/api/health` on Vercel, `http://localhost:3000/...` in dev SSR.
 * export const healthUrl = (): URL => new URL('/api/health', getBaseUrl());
 * ```
 *
 * @see {@link createNextRpcClient}
 * @category utils
 * @since 0.1.0
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

/**
 * Options of {@link createNextRpcClient}. All are optional.
 *
 * **Details**
 *
 * - There is no `keyPrefix` option: the options proxy of `useRpc()` never prefixes query keys.
 *
 * @see {@link createNextRpcClient}
 * @category options
 * @since 0.1.0
 */
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

/**
 * Props of the `RpcProvider` of {@link createNextRpcClient}.
 *
 * @see {@link NextRpcClient}
 * @category models
 * @since 0.1.0
 */
export interface NextRpcProviderProps {
  readonly children?: React.ReactNode;
  /** Use this query client instead of `getQueryClient()`. */
  readonly queryClient?: QueryClient | undefined;
}

/**
 * What {@link createNextRpcClient} returns (the exports of tRPC's `trpc/client.tsx`).
 *
 * @see {@link createNextRpcClient}
 * @category models
 * @since 0.1.0
 */
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
 * Creates the client half of an App Router integration (tRPC's `trpc/client.tsx`): a provider,
 * the `useRpc` / `useRpcClient` hooks and the router's Schema-aware `HydrationBoundary`.
 *
 * **When to use**
 *
 * Call it once, at module level, in a `'use client'` module (e.g. `trpc/client.tsx`), and render
 * `RpcProvider` in `app/layout.tsx`. Prefer `createRscHelpers` for server components and
 * `createServerActionCaller` + `useServerAction` for mutations that should run as server actions.
 *
 * **Details**
 *
 * - `RpcProvider` renders `QueryClientProvider` plus the effect-trpc context. It takes the query
 *   client from its `queryClient` prop, else from `getQueryClient()`, and creates one
 *   `httpLink` client per provider instance (it does not dispose it on unmount).
 * - `url` defaults to `"/api/rpc"` and is resolved against `getBaseUrl()` when the client is
 *   created, because `httpLink` needs an absolute url, also during SSR of client components.
 * - `getQueryClient()` returns a **new** `QueryClient` per call on the server (one per SSR
 *   request) and a singleton in the browser (React suspending during the first render must not
 *   throw the cache away).
 * - Results are decoded with the router's schemas: `useQuery` data are class instances and
 *   errors are `ClientError<E>` (`E | RpcDefect | RpcTransportError | RpcInterrupted`).
 *
 * **Gotchas**
 *
 * - The router **value** (its schemas) ships to the browser, unlike tRPC's type-only import.
 *   Keep it in a schemas-only module; never import handlers (`server-only`) into this file.
 * - Pass this module's `HydrationBoundary` to `createRscHelpers`: a server component may only
 *   render client components that come from a `'use client'` module.
 * - `serialization` must match `createRouteHandler`'s. On a non-Vercel host behind a proxy, pass
 *   an absolute `url` so SSR does not call `http://localhost:$PORT`.
 * - There is no `keyPrefix`: do not set `keyPrefix` in `createRscHelpers` when its data must be
 *   read by this provider's `useRpc()`, the query keys would not match.
 *
 * **Example** (trpc/client.tsx, a `'use client'` module)
 *
 * ```tsx
 * // trpc/client.tsx — client code
 * 'use client';
 * import { query, Router } from '@effect-trpc/core';
 * import { createNextRpcClient } from '@effect-trpc/next';
 * import { Schema } from 'effect';
 *
 * // server/router.ts in a real app: schemas only, no handlers.
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * export const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post }) },
 * });
 *
 * export const { RpcProvider, useRpc, useRpcClient, HydrationBoundary } = createNextRpcClient(
 *   appRouter,
 *   { url: '/api/rpc' }, // the folder of app/api/rpc/[[...rpc]]/route.ts
 * );
 * ```
 *
 * **Example** (Root layout and a client component reading a query)
 *
 * ```tsx
 * // app/layout.tsx (server component) + app/post-view.tsx ('use client')
 * import { query, Router } from '@effect-trpc/core';
 * import { createNextRpcClient } from '@effect-trpc/next';
 * import { useSuspenseQuery } from '@tanstack/react-query';
 * import { Schema } from 'effect';
 * import type { ReactNode } from 'react';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {
 *   get headline(): string {
 *     return this.title.toUpperCase();
 *   }
 * }
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post }) },
 * });
 * // trpc/client.tsx
 * const { RpcProvider, useRpc } = createNextRpcClient(appRouter);
 *
 * // app/layout.tsx
 * export default function RootLayout({ children }: { children: ReactNode }) {
 *   return (
 *     <html lang="en">
 *       <body>
 *         <RpcProvider>{children}</RpcProvider>
 *       </body>
 *     </html>
 *   );
 * }
 *
 * // app/post-view.tsx
 * export function PostView({ id }: { id: number }) {
 *   const rpc = useRpc();
 *   const { data } = useSuspenseQuery(rpc.post.byId.queryOptions({ id }));
 *   return <h1>{data.headline}</h1>; // a real Post instance: getters work
 * }
 * ```
 *
 * @see {@link createRscHelpers} for the server-component half
 * @see {@link createRouteHandler} for the endpoint `url` points at
 * @see {@link getBaseUrl}
 * @category constructors
 * @since 0.1.0
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
