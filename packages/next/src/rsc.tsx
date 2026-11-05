/**
 * React Server Components helpers for the App Router + TanStack Query (tRPC's `trpc/server.tsx`).
 *
 * {@link createRscHelpers} gives server components a per-request `QueryClient`, the
 * `@effect-trpc/tanstack-react-query` options proxy (`rpc`), a fire-and-forget `prefetch`, and
 * `HydrateClient`, which dehydrates the request's cache with the procedures' schemas and renders
 * the client `HydrationBoundary` from `createNextRpcClient`. By default the router runs
 * in-process (`localLink`), with no HTTP hop. Server-only.
 *
 * @since 0.1.0
 */
import { createClient, localLink } from '@effect-trpc/client';
import type { Client, HeadersOption } from '@effect-trpc/client';
import type { Router } from '@effect-trpc/core';
import { RpcTransportError } from '@effect-trpc/core';
import type { Caller } from '@effect-trpc/server';
import {
  createHydrationHelpers,
  createRpcOptionsProxy,
  QueryKeys,
} from '@effect-trpc/tanstack-react-query';
import type {
  DefaultFeatureFlags,
  RpcDehydrateOptions,
  RpcOptionsProxy,
} from '@effect-trpc/tanstack-react-query';
import type { DehydratedState, QueryClient } from '@tanstack/react-query';
import { Effect, Stream } from 'effect';
import type { Layer } from 'effect';
import * as React from 'react';
import { makeQueryClient } from './queryClient.js';

/**
 * A memoizer: `React.cache` in server components (one value per request).
 *
 * **Details**
 *
 * - Inject your own in tests to simulate request scopes; outside an RSC render `React.cache`
 *   does not memoize.
 *
 * @see {@link RscHelpersOptions}
 * @category models
 * @since 0.1.0
 */
export type CacheFn = <T>(fn: () => T) => () => T;

/**
 * Runs the router in-process: no HTTP hop and no serialization between server components and
 * handlers. With this source `createRscHelpers` also returns a `caller`.
 *
 * @see {@link createRscHelpers}
 * @category options
 * @since 0.1.0
 */
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

/**
 * Calls the router through an existing client (e.g. `httpLink` to another service).
 *
 * **Gotchas**
 *
 * - The client is shared by every request; per-request headers must come from its own
 *   `headers` function. `createRscHelpers` never disposes it.
 *
 * @see {@link createRscHelpers}
 * @category options
 * @since 0.1.0
 */
export interface RscClientSource<R extends Router.Any> {
  /** The Promise client every query function of `rpc` calls. */
  readonly client: Client<R>;
}

/**
 * The component rendering the dehydrated state on the client: the `HydrationBoundary` returned
 * by `createNextRpcClient` (or `createHydrationHelpers(router).HydrationBoundary`).
 *
 * @see {@link RscHelpersOptions}
 * @category models
 * @since 0.1.0
 */
export type HydrationBoundaryComponent = React.ComponentType<{
  readonly state: DehydratedState;
  readonly children?: React.ReactNode;
}>;

/**
 * Options of {@link createRscHelpers}. All are optional, but real App Router apps must pass
 * `HydrationBoundary`.
 *
 * @see {@link createRscHelpers}
 * @category options
 * @since 0.1.0
 */
export interface RscHelpersOptions<P extends string | undefined = undefined> {
  /** Creates the per-request query client. Defaults to {@link makeQueryClient}. */
  readonly makeQueryClient?: (() => QueryClient) | undefined;
  /**
   * Memoizes `makeQueryClient` per request. Defaults to `React.cache`, which only memoizes inside
   * a React Server Components render (elsewhere every call creates a new client). Inject your
   * own scope in tests.
   */
  readonly cache?: CacheFn | undefined;
  /**
   * Query key prefix of the options proxy. Client components only find the prefetched data when
   * their provider uses the same prefix: pass the same `keyPrefix` to `createNextRpcClient`.
   */
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

/**
 * Feature flags of the options proxy for a key prefix option `P`: `{ keyPrefix: true }` when a
 * string prefix was given, the default flags otherwise.
 *
 * @category type-level
 * @since 0.1.0
 */
export type PrefixFlags<P extends string | undefined> = [P] extends [string]
  ? { readonly keyPrefix: true }
  : DefaultFeatureFlags;

/**
 * Options accepted by `prefetch`: anything with a query key (`rpc.x.queryOptions(...)` or
 * `rpc.x.infiniteQueryOptions(...)`).
 *
 * @see {@link RscHelpers}
 * @category models
 * @since 0.1.0
 */
export interface PrefetchableOptions {
  /** The query key; infinite query keys select `prefetchInfiniteQuery`. */
  readonly queryKey: ReadonlyArray<unknown>;
}

/**
 * What {@link createRscHelpers} returns (the exports of tRPC's `trpc/server.tsx`).
 *
 * @see {@link createRscHelpers}
 * @category models
 * @since 0.1.0
 */
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
   * (`prefetchInfiniteQuery` for infinite query options, `prefetchQuery` otherwise). A failure
   * that happens while the pending query streams reaches the client as a plain `Error`; `await
   * getQueryClient().prefetchQuery(...)` instead when the page needs the typed error.
   */
  readonly prefetch: (options: PrefetchableOptions) => void;
  /** The Schema-aware dehydrated state of the request's query client. */
  readonly dehydrate: () => DehydratedState;
}

/**
 * {@link RscHelpers} for in-process handlers (`{ handlers }` source), plus a direct caller.
 *
 * @see {@link createRscHelpers}
 * @category models
 * @since 0.1.0
 */
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

const isTransportError = (error: unknown): error is RpcTransportError =>
  error instanceof RpcTransportError;

/** A client's `RpcTransportError` (a throwing `headers()`, a disposed client) is a caller defect. */
const dieOnTransportError = (result: unknown): unknown =>
  Stream.isStream(result)
    ? Stream.catchIf(result, isTransportError, (error) => Stream.die(error))
    : Effect.isEffect(result)
      ? // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- `client.$effect` is walked untyped here; `Caller<R>` restores each procedure's error type
        Effect.catchIf(result, isTransportError, (error) => Effect.die(error))
      : result;

/** Wraps a node of `client.$effect`: children are wrapped, calls go through `dieOnTransportError`. */
const wrapEffectNode = <T,>(node: T): T =>
  typeof node === 'function' || (typeof node === 'object' && node !== null)
    ? new Proxy(node, {
        get: (target, key): unknown => wrapEffectNode(Reflect.get(target, key)),
        // the `apply` trap only runs for function targets
        apply: (target, thisArg, args: ReadonlyArray<unknown>): unknown =>
          typeof target === 'function'
            ? dieOnTransportError(Reflect.apply(target, thisArg, args))
            : undefined,
      })
    : node;

/**
 * The `caller` of the `{ handlers }` source, backed by the in-process `client`: both share one
 * runtime (the handler layer is built once, and released once) and the client's `headers`.
 */
const callerFromClient = <R extends Router.Any>(router: R, client: Client<R>): Caller<R> => {
  const effectRoot = wrapEffectNode(client.$effect);
  const target: object = Object.create(null);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the proxy implements `$promise`, `$router`, `dispose` and every procedure path of `client.$effect`, which is the shape `Caller<R>` describes
  return new Proxy(target, {
    get: (_target, key) => {
      switch (key) {
        case '$promise':
          return client;
        case '$router':
          return router;
        case 'dispose':
        case Symbol.asyncDispose:
          return client.dispose;
        default:
          return Reflect.get(effectRoot, key);
      }
    },
  }) as Caller<R>;
};

/**
 * Creates server-component helpers for the App Router + TanStack Query (tRPC's
 * `trpc/server.tsx`), running the router in-process.
 *
 * **When to use**
 *
 * Use it once, in a server-only `trpc/server.tsx`, to prefetch queries in server components and
 * hand them to client components through `HydrateClient`. Use the `{ client }` overload when the
 * router is served by another process. Use `createServerActionCaller` for mutations triggered from
 * client components.
 *
 * **Details**
 *
 * - `{ handlers }` runs the router in-process through `localLink` (no HTTP hop, no
 *   serialization); middleware still runs. `headers` (a function is evaluated per call) are the
 *   rpc headers handlers and middleware see: forward Next's `headers()`.
 * - `getQueryClient` is `cache(makeQueryClient)`: one query client per request inside an RSC
 *   render. `cache` defaults to `React.cache` (React 19); without it every call creates a new
 *   client.
 * - `rpc` is the `@effect-trpc/tanstack-react-query` options proxy bound to `getQueryClient`, the
 *   same API as `useRpc()` on the client.
 * - `prefetch(options)` is fire and forget (`void`); thanks to `makeQueryClient`'s
 *   `shouldDehydrateQuery`, pending queries stream to the client.
 * - `HydrateClient` renders `HydrationBoundary` with `dehydrate(router, getQueryClient())`:
 *   `Schema.Class` data and `TaggedError`s are JSON-encoded with the procedures' schemas and
 *   decoded back to instances by the client boundary.
 * - `caller` (tRPC's `createCaller`) reads data directly, without the query cache:
 *   `await caller.$promise.post.byId({ id })`. Errors reject as `E | RpcDefect | ...` instances.
 *
 * **Gotchas**
 *
 * - Server-only: add `import 'server-only'` to the file; it imports your handlers. Never import
 *   it from a `'use client'` module.
 * - Pass `{ HydrationBoundary }` from your `'use client'` module (`createNextRpcClient`); the
 *   default boundary is not a client reference and only works outside RSC (tests).
 * - Never replace `getQueryClient` with a module-level `QueryClient`: it would be shared across
 *   requests and users. Outside an RSC render (route handlers, server actions) `React.cache`
 *   does not memoize, so `prefetch` and `HydrateClient` would see different clients there.
 * - A pending query that fails while streaming loses its `TaggedError` class (React serializes
 *   the rejection as `Error`); `await getQueryClient().prefetchQuery(...)` when the page needs
 *   typed errors.
 * - `client` and `caller` share one in-process runtime: the handler layer is built once, both
 *   send `headers`, and disposing either one disposes both.
 * - `keyPrefix` must match the `keyPrefix` of `createNextRpcClient` (both unset by default).
 *
 * **Example** (trpc/server.tsx, server only)
 *
 * ```tsx
 * // trpc/server.tsx — server only (add `import 'server-only'` in the app)
 * import { query, Router } from '@effect-trpc/core';
 * import { createNextRpcClient, createRscHelpers } from '@effect-trpc/next';
 * import { Handlers } from '@effect-trpc/server';
 * import { Effect, Schema } from 'effect';
 *
 * // In the app: `import { headers } from 'next/headers'`.
 * declare const headers: () => Promise<Headers>;
 *
 * // server/router.ts (shared) and server/handlers.ts (server only)
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post }) },
 * });
 * const HandlersLive = Handlers.make(appRouter, {
 *   post: { byId: ({ id }) => Effect.succeed(new Post({ id, title: 'Hello' })) },
 * });
 *
 * // In the app this comes from `import { HydrationBoundary } from './client'` ('use client').
 * const { HydrationBoundary } = createNextRpcClient(appRouter);
 *
 * export const { getQueryClient, rpc, HydrateClient, prefetch, caller } = createRscHelpers(
 *   appRouter,
 *   // In-process: no HTTP hop. Forward the request headers to middleware and handlers.
 *   { handlers: HandlersLive, headers: async () => await headers() },
 *   { HydrationBoundary },
 * );
 * ```
 *
 * **Example** (app/page.tsx, a server component prefetching for a client component)
 *
 * ```tsx
 * // app/page.tsx — server component
 * import { query, Router } from '@effect-trpc/core';
 * import { createNextRpcClient, createRscHelpers } from '@effect-trpc/next';
 * import { Handlers } from '@effect-trpc/server';
 * import { useSuspenseQuery } from '@tanstack/react-query';
 * import { Effect, Schema } from 'effect';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post }) },
 * });
 * const HandlersLive = Handlers.make(appRouter, {
 *   post: { byId: ({ id }) => Effect.succeed(new Post({ id, title: 'Hello' })) },
 * });
 * // trpc/client.tsx ('use client') and trpc/server.tsx (server only)
 * const { HydrationBoundary, useRpc } = createNextRpcClient(appRouter);
 * const { HydrateClient, prefetch, rpc, caller } = createRscHelpers(
 *   appRouter,
 *   { handlers: HandlersLive },
 *   { HydrationBoundary },
 * );
 *
 * // app/post-view.tsx ('use client'): finds the prefetched Post, no client fetch.
 * function PostView({ id }: { id: number }) {
 *   const { data } = useSuspenseQuery(useRpc().post.byId.queryOptions({ id }));
 *   return <h1>{data.title}</h1>;
 * }
 *
 * export default function Page() {
 *   // Not awaited: the pending query streams to the client with the RSC payload.
 *   prefetch(rpc.post.byId.queryOptions({ id: 1 }));
 *   return (
 *     <HydrateClient>
 *       <PostView id={1} />
 *     </HydrateClient>
 *   );
 * }
 *
 * // Reading without the cache, e.g. for metadata:
 * export async function generateMetadata() {
 *   const post = await caller.$promise.post.byId({ id: 1 });
 *   return { title: post.title };
 * }
 * ```
 *
 * @see {@link createNextRpcClient} for the `HydrationBoundary` and `useRpc`
 * @see {@link makeQueryClient}
 * @category constructors
 * @since 0.1.0
 */
export function createRscHelpers<
  R extends Router.Any,
  const P extends string | undefined = undefined,
>(
  router: R,
  source: RscHandlersSource<R>,
  options?: RscHelpersOptions<P>,
): RscHelpersWithCaller<R, P>;
/**
 * Creates server-component helpers that call the router through an existing client (e.g.
 * `httpLink` to another service), instead of running it in-process.
 *
 * **When to use**
 *
 * Use it when the handlers live in another process. Prefer the `{ handlers }` overload when the
 * Next app owns the handlers: it avoids the HTTP hop and also returns a `caller`.
 *
 * **Details**
 *
 * - Same helpers as the `{ handlers }` overload, without `caller`.
 * - Values cross the wire with the procedures' schemas, so prefetched data are still class
 *   instances in the request's query client.
 *
 * **Gotchas**
 *
 * - The client is module-level and shared by all requests; it needs an absolute url on the
 *   server (`httpLink` has no origin to resolve a relative url against).
 * - The helpers never dispose the client.
 *
 * **Example** (trpc/server.tsx backed by a remote rpc service, server only)
 *
 * ```tsx
 * // trpc/server.tsx — server only
 * import { createClient, httpLink } from '@effect-trpc/client';
 * import { query, Router } from '@effect-trpc/core';
 * import { createNextRpcClient, createRscHelpers } from '@effect-trpc/next';
 * import { Schema } from 'effect';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post }) },
 * });
 * const { HydrationBoundary } = createNextRpcClient(appRouter); // from './client' in the app
 *
 * // Absolute url: there is no page origin on the server.
 * const remote = createClient(appRouter, {
 *   link: httpLink({ url: 'https://posts.internal.example.com/api/rpc' }),
 * });
 *
 * export const { rpc, prefetch, HydrateClient, getQueryClient } = createRscHelpers(
 *   appRouter,
 *   { client: remote },
 *   { HydrationBoundary },
 * );
 * ```
 *
 * @see {@link RscClientSource}
 * @category constructors
 * @since 0.1.0
 */
export function createRscHelpers<
  R extends Router.Any,
  const P extends string | undefined = undefined,
>(router: R, source: RscClientSource<R>, options?: RscHelpersOptions<P>): RscHelpers<R, P>;
/** Implementation of the `createRscHelpers` overloads. @internal */
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
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- passes the public `handlers` layer through unchanged: its construction error is `unknown` by design, matching `localLink`'s own option
      link: localLink({ handlers: source.handlers }),
      ...(source.headers !== undefined && { headers: source.headers }),
      // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- the public `middleware` option accepts any layer error, as `createClient`'s own option does
      ...(source.middleware !== undefined && { middleware: source.middleware }),
    });
    caller = callerFromClient(router, client);
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `KeyPrefixOptions<PrefixFlags<P>>` is a conditional type on a generic flag that no literal can satisfy; `keyPrefix` is passed exactly when `P` is a string
  const rpc = createRpcOptionsProxy<R, PrefixFlags<P>>({
    client,
    queryClient: getQueryClient,
    ...(options.keyPrefix !== undefined && { keyPrefix: options.keyPrefix }),
  } as unknown as Parameters<typeof createRpcOptionsProxy<R, PrefixFlags<P>>>[0]);

  const hydration = createHydrationHelpers(
    router,
    options.keyPrefix === undefined ? undefined : { keyPrefix: options.keyPrefix },
  );
  const Boundary: HydrationBoundaryComponent =
    options.HydrationBoundary ?? hydration.HydrationBoundary;

  const dehydrateRequest = (): DehydratedState =>
    hydration.dehydrate(getQueryClient(), options.dehydrateOptions);

  const HydrateClient: React.FC<{ readonly children?: React.ReactNode }> = ({ children }) => (
    <Boundary state={dehydrateRequest()}>{children}</Boundary>
  );
  HydrateClient.displayName = 'HydrateClient';

  const prefetch = (prefetchOptions: PrefetchableOptions): void => {
    const queryClient = getQueryClient();
    if (isPrefetchInfinite(prefetchOptions.queryKey)) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the key says these options came from `infiniteQueryOptions()`, which builds TanStack infinite query options
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
