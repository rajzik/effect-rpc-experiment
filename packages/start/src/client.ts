/**
 * effect-trpc clients for TanStack Start: in-process on the server, `httpLink` in the browser.
 *
 * {@link createServerClient} runs the router's handlers in-process (`localLink`) for loaders and
 * SSR, {@link createBrowserClient} calls the `createStartHandler` route over `httpLink`, and
 * {@link createIsomorphicClient} picks one by environment. All return the `@effect-trpc/client`
 * Promise client (`Client<R>`) whose results are `Schema.Class` instances and whose errors are
 * `ClientError<E>`. Pass the client to `createStartHelpers` for TanStack Query.
 *
 * @since 0.1.0
 */
import { createClient, httpLink, localLink } from '@effect-trpc/client';
import type {
  Client,
  HeadersOption,
  MiddlewareOption,
  SerializationOption,
} from '@effect-trpc/client';
import type { Router } from '@effect-trpc/core';
import type { Handlers } from '@effect-trpc/server';
import type { Layer } from 'effect';
import { defaultStartPath } from './handler.js';

/**
 * Options of {@link getBaseUrl} and {@link getRpcUrl}.
 *
 * @category options
 * @since 0.1.0
 */
export interface BaseUrlOptions {
  /**
   * The origin used on the server, where there is no `window.location` (e.g.
   * `"https://my-app.com"`). Defaults to the `PUBLIC_URL` / `URL` environment variable, then to
   * `VERCEL_URL` (as `https://...`), then to `http://localhost:${PORT ?? 3000}`.
   */
  readonly serverOrigin?: string | undefined;
}

const env = (name: string): string | undefined => {
  const value = typeof process === 'undefined' ? undefined : process.env[name];
  return value === undefined || value === '' ? undefined : value;
};

/**
 * Returns the origin rpc urls are resolved against.
 *
 * **When to use**
 *
 * Use it to build absolute urls to your own app from code that runs during SSR and in the
 * browser. `createBrowserClient` and `getRpcUrl` already call it for relative urls.
 *
 * **Details**
 *
 * - Browser: `window.location.origin` (`serverOrigin` is ignored).
 * - Server (SSR, where `fetch` needs absolute urls), first match wins: `serverOrigin`, the
 *   `PUBLIC_URL` or `URL` environment variable, `https://${VERCEL_URL}`, then
 *   `http://localhost:${PORT ?? 3000}`. Empty variables are skipped; trailing slashes of
 *   `serverOrigin` / `PUBLIC_URL` / `URL` are removed.
 *
 * **Gotchas**
 *
 * - In production behind a proxy or on a non-Vercel host, set `PUBLIC_URL` (or pass
 *   `serverOrigin`), otherwise SSR calls `http://localhost:3000`.
 *
 * **Example** (Explicit origin for SSR)
 *
 * ```ts
 * // src/rpc/urls.ts — server or browser
 * import { getBaseUrl } from '@effect-trpc/start';
 *
 * // Browser: the page origin. Server: the configured origin instead of the env fallbacks.
 * export const origin = getBaseUrl({ serverOrigin: 'https://my-app.com/' }); // no trailing slash
 * ```
 *
 * @see {@link getRpcUrl}
 * @category utils
 * @since 0.1.0
 */
export const getBaseUrl = (options: BaseUrlOptions = {}): string => {
  if (typeof window !== 'undefined') return window.location.origin;
  if (options.serverOrigin !== undefined) return options.serverOrigin.replace(/\/+$/, '');
  const explicit = env('PUBLIC_URL') ?? env('URL');
  if (explicit !== undefined) return explicit.replace(/\/+$/, '');
  const vercel = env('VERCEL_URL');
  if (vercel !== undefined) return `https://${vercel}`;
  return `http://localhost:${env('PORT') ?? '3000'}`;
};

/**
 * Resolves an rpc url against {@link getBaseUrl}: absolute urls are returned unchanged, relative
 * ones (`"/api/rpc"`, the default) are made absolute.
 *
 * **When to use**
 *
 * Use it when you build your own `httpLink` (e.g. a `wsLink` or extra headers) and still want
 * the Start origin rules. `createBrowserClient` calls it for you.
 *
 * **Example** (A hand-made httpLink client with the Start origin rules)
 *
 * ```ts
 * // src/rpc/client.ts — browser (and SSR) code
 * import { createClient, httpLink } from '@effect-trpc/client';
 * import { query, Router } from '@effect-trpc/core';
 * import { getRpcUrl } from '@effect-trpc/start';
 * import { Schema } from 'effect';
 *
 * const appRouter = Router.make({ health: query({ success: Schema.String }) });
 *
 * export const client = createClient(appRouter, {
 *   link: httpLink({ url: getRpcUrl('/api/rpc'), serialization: 'json' }),
 * });
 * ```
 *
 * @see {@link getBaseUrl}
 * @category utils
 * @since 0.1.0
 */
export const getRpcUrl = (url: string | URL = defaultStartPath, options?: BaseUrlOptions): URL =>
  new URL(url, `${getBaseUrl(options)}/`);

/**
 * Options of {@link createServerClient}. `handlers` is required; `middleware` provides the
 * client side of middleware declared with `requiredForClient: true`.
 *
 * @category options
 * @since 0.1.0
 */
export type ServerClientOptions<R extends Router.Any> = {
  /**
   * The server implementation (the same layer you give `createStartHandler`): handlers of every
   * procedure and the server side of every middleware.
   */
  readonly handlers: Layer.Layer<Handlers.Requirements<R>, unknown>;
  /** Rpc headers sent with every call (a function is evaluated once per call). */
  readonly headers?: HeadersOption | undefined;
} & MiddlewareOption<R>;

/**
 * Options of {@link createBrowserClient}. All are optional.
 *
 * @category options
 * @since 0.1.0
 */
export type BrowserClientOptions<R extends Router.Any> = {
  /**
   * The rpc endpoint. Relative urls (`"/api/rpc"`, the default) are resolved with
   * {@link getBaseUrl}, so they also work during SSR.
   */
  readonly url?: string | URL | undefined;
  /** HTTP headers of every request; a function is evaluated once per request. */
  readonly headers?: HeadersOption | undefined;
  /** Wire format; must match the server's `serialization`. Default `"ndjson"`. */
  readonly serialization?: SerializationOption | undefined;
  /** Custom `fetch` (credentials, a test double, ...). */
  readonly fetch?: typeof globalThis.fetch | undefined;
  /** Origin used to resolve a relative `url` on the server; see {@link getBaseUrl}. */
  readonly serverOrigin?: string | undefined;
} & MiddlewareOption<R>;

/**
 * Options of {@link createIsomorphicClient}. `server.handlers` and `client` are required.
 *
 * @category options
 * @since 0.1.0
 */
export type IsomorphicClientOptions<R extends Router.Any> = {
  /** Used when `isServer`: the handlers run in-process (no HTTP round trip, no serialization). */
  readonly server: {
    readonly handlers: Layer.Layer<Handlers.Requirements<R>, unknown>;
    /** Rpc headers sent with every in-process call. */
    readonly headers?: HeadersOption | undefined;
  };
  /** Used in the browser: `httpLink` to the server route. */
  readonly client: Omit<BrowserClientOptions<R>, 'middleware'>;
  /** Selects the transport. Defaults to `typeof window === 'undefined'`. */
  readonly isServer?: boolean | undefined;
} & MiddlewareOption<R>;

const middlewareOf = (options: object): object =>
  'middleware' in options && options.middleware !== undefined
    ? { middleware: options.middleware }
    : {};

/**
 * Creates a client that calls the router's handlers in-process (`localLink`): for loaders,
 * server functions and SSR on the server.
 *
 * **When to use**
 *
 * Use it in server-only code, typically as the `.server()` branch of Start's
 * `createIsomorphicFn()` so the handlers stay out of the browser bundle. Prefer
 * `createIsomorphicClient` when bundle size of the server code does not matter.
 *
 * **Details**
 *
 * - Values are passed by reference (no serialization), the router's middleware still runs.
 * - `headers` (a function is evaluated per call) are what handlers see as `ctx.headers`.
 * - Errors are `ClientError<E>` instances, as over HTTP.
 *
 * **Gotchas**
 *
 * - Server-only: it imports your handlers. Importing this module from browser code bundles them.
 * - Create it once per server, not per request, and `await client.dispose()` on shutdown.
 *
 * **Example** (A server-only client kept out of the browser bundle)
 *
 * ```ts
 * // src/rpc/client.ts — shared module; the .server() branch is removed from the browser build
 * import { query, Router } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 * import { createBrowserClient, createServerClient } from '@effect-trpc/start';
 * import { createIsomorphicFn } from '@tanstack/react-start';
 * import { Effect, Schema } from 'effect';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post }) },
 * });
 * // src/rpc/handlers.server.ts in a real app
 * const HandlersLive = Handlers.make(appRouter, {
 *   post: { byId: ({ id }) => Effect.succeed(new Post({ id, title: 'Hello' })) },
 * });
 *
 * const makeClient = createIsomorphicFn()
 *   .server(() => createServerClient(appRouter, { handlers: HandlersLive }))
 *   .client(() => createBrowserClient(appRouter, { url: '/api/rpc' }));
 * export const client = makeClient();
 * ```
 *
 * @see {@link createIsomorphicClient}
 * @category constructors
 * @since 0.1.0
 */
export const createServerClient = <R extends Router.Any>(
  router: R,
  options: ServerClientOptions<R>,
): Client<R> =>
  createClient(router, {
    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- passes the public `handlers` layer through unchanged: its construction error is `unknown` by design, matching `localLink`'s own option
    link: localLink({ handlers: options.handlers }),
    ...(options.headers !== undefined && { headers: options.headers }),
    ...middlewareOf(options),
  });

/**
 * Creates a client over `httpLink` to the Start server route (default `/api/rpc`, resolved to an
 * absolute url with {@link getBaseUrl}).
 *
 * **When to use**
 *
 * Use it in browser code, typically as the `.client()` branch of `createIsomorphicFn()`, or to
 * call a Start app from another process. Prefer `createServerClient` on the server of the same
 * app (no HTTP round trip).
 *
 * **Details**
 *
 * - Class instances and typed errors are decoded with the procedures' schemas; network failures
 *   become `RpcTransportError`.
 * - The url is resolved once, when the client is created.
 *
 * **Gotchas**
 *
 * - Used during SSR, a relative `url` resolves with the server fallbacks of `getBaseUrl`
 *   (`serverOrigin`, `PUBLIC_URL` / `URL`, `VERCEL_URL`, `localhost`): set one of them, or pass an
 *   absolute `url`.
 * - `serialization` must match `createStartHandler`'s.
 *
 * **Example** (Browser client with credentials)
 *
 * ```ts
 * // src/rpc/client.ts — browser code
 * import { query, Router } from '@effect-trpc/core';
 * import { createBrowserClient } from '@effect-trpc/start';
 * import { Schema } from 'effect';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post }) },
 * });
 *
 * export const client = createBrowserClient(appRouter, {
 *   url: '/api/rpc',
 *   fetch: (input, init) => fetch(input, { ...init, credentials: 'include' }),
 *   serverOrigin: 'https://my-app.com', // only used when this runs during SSR
 * });
 *
 * export const loadPost = (id: number): Promise<Post> => client.post.byId({ id });
 * ```
 *
 * @see {@link createIsomorphicClient}
 * @category constructors
 * @since 0.1.0
 */
export const createBrowserClient = <R extends Router.Any>(
  router: R,
  options: BrowserClientOptions<R> = {},
): Client<R> =>
  createClient(router, {
    link: httpLink({
      url: getRpcUrl(options.url, { serverOrigin: options.serverOrigin }),
      ...(options.headers !== undefined && { headers: options.headers }),
      ...(options.serialization !== undefined && { serialization: options.serialization }),
      ...(options.fetch !== undefined && { fetch: options.fetch }),
    }),
    ...middlewareOf(options),
  });

/**
 * Creates one client for code that runs on both sides (route loaders, components): in-process
 * ({@link createServerClient}) when `isServer`, `httpLink` ({@link createBrowserClient})
 * otherwise. Both yield real `Schema.Class` / `TaggedError` instances.
 *
 * **When to use**
 *
 * Use it for the simplest setup, passing the result to `createStartHelpers`. Switch to
 * `createIsomorphicFn()` + `createServerClient` / `createBrowserClient` when the handlers must
 * not reach the browser bundle.
 *
 * **Details**
 *
 * - `isServer` defaults to `typeof window === 'undefined'` and is evaluated once, when the client
 *   is created.
 * - `middleware` applies to both halves; `server.headers` only to the in-process half.
 *
 * **Gotchas**
 *
 * - The module calling this imports `HandlersLive`, so the server handlers end up in the client
 *   bundle; to keep them server-only, wrap {@link createServerClient} /
 *   {@link createBrowserClient} in Start's `createIsomorphicFn()` (see the README).
 *
 * **Example** (src/rpc/client.ts, shared by loaders and components)
 *
 * ```ts
 * // src/rpc/client.ts — runs on the server (SSR, loaders) and in the browser
 * import { query, Router } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 * import { createIsomorphicClient, createStartHelpers } from '@effect-trpc/start';
 * import { Effect, Schema } from 'effect';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post }) },
 * });
 * const HandlersLive = Handlers.make(appRouter, {
 *   post: { byId: ({ id }) => Effect.succeed(new Post({ id, title: 'Hello' })) },
 * });
 *
 * export const client = createIsomorphicClient(appRouter, {
 *   server: { handlers: HandlersLive }, // isServer: in-process, no HTTP, no serialization
 *   client: { url: '/api/rpc' }, // browser: httpLink to src/routes/api/rpc.$.ts
 * });
 * export const { rpc, RpcProvider, useRpc, hydration } = createStartHelpers(appRouter, { client });
 * ```
 *
 * @see {@link createServerClient}
 * @see {@link createBrowserClient}
 * @category constructors
 * @since 0.1.0
 */
export const createIsomorphicClient = <R extends Router.Any>(
  router: R,
  options: IsomorphicClientOptions<R>,
): Client<R> => {
  const isServer = options.isServer ?? typeof window === 'undefined';
  const middleware = middlewareOf(options);
  return isServer
    ? createServerClient(router, {
        // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- passes the public `handlers` layer through unchanged: its construction error is `unknown` by design, matching `localLink`'s own option
        handlers: options.server.handlers,
        ...(options.server.headers !== undefined && { headers: options.server.headers }),
        ...middleware,
      })
    : createBrowserClient(router, { ...options.client, ...middleware });
};
