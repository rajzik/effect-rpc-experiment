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

/** Options of {@link getBaseUrl}. */
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
 * The origin rpc urls are resolved against: `window.location.origin` in the browser; on the
 * server (SSR, where `fetch` needs absolute urls) `serverOrigin`, else the `PUBLIC_URL` / `URL`
 * environment variable, else `https://${VERCEL_URL}`, else `http://localhost:${PORT ?? 3000}`.
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
 * ones (`"/api/rpc"`) are made absolute.
 */
export const getRpcUrl = (url: string | URL = defaultStartPath, options?: BaseUrlOptions): URL =>
  new URL(url, `${getBaseUrl(options)}/`);

/** Options of {@link createServerClient}. */
export type ServerClientOptions<R extends Router.Any> = {
  /**
   * The server implementation (the same layer you give `createStartHandler`): handlers of every
   * procedure and the server side of every middleware.
   */
  readonly handlers: Layer.Layer<Handlers.Requirements<R>, unknown>;
  /** Rpc headers sent with every call (a function is evaluated once per call). */
  readonly headers?: HeadersOption | undefined;
} & MiddlewareOption<R>;

/** Options of {@link createBrowserClient}. */
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

/** Options of {@link createIsomorphicClient}. */
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
 * A client that calls the router's handlers in-process (`localLink`): for loaders, server
 * functions and SSR on the server. Values are passed by reference (no serialization), the
 * router's middleware still runs. Dispose it when the server shuts down.
 */
export const createServerClient = <R extends Router.Any>(
  router: R,
  options: ServerClientOptions<R>,
): Client<R> =>
  createClient(router, {
    link: localLink({ handlers: options.handlers }),
    ...(options.headers !== undefined && { headers: options.headers }),
    ...middlewareOf(options),
  });

/**
 * A client over `httpLink` to the Start server route (default `/api/rpc`, resolved to an absolute
 * url with {@link getBaseUrl}). Class instances and typed errors are decoded with the
 * procedures' schemas.
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
 * One client for code that runs on both sides (route loaders, components): in-process
 * ({@link createServerClient}) when `isServer`, `httpLink` ({@link createBrowserClient})
 * otherwise. Both yield real `Schema.Class` / `TaggedError` instances.
 *
 * ```ts
 * export const client = createIsomorphicClient(appRouter, {
 *   server: { handlers: HandlersLive },
 *   client: { url: '/api/rpc' },
 * });
 * ```
 *
 * Note that the module importing this pulls the server handlers into the client bundle; to keep
 * them server-only, wrap {@link createServerClient} / {@link createBrowserClient} in Start's
 * `createIsomorphicFn()` (see the README).
 */
export const createIsomorphicClient = <R extends Router.Any>(
  router: R,
  options: IsomorphicClientOptions<R>,
): Client<R> => {
  const isServer = options.isServer ?? typeof window === 'undefined';
  const middleware = middlewareOf(options);
  return isServer
    ? createServerClient(router, {
        handlers: options.server.handlers,
        ...(options.server.headers !== undefined && { headers: options.server.headers }),
        ...middleware,
      })
    : createBrowserClient(router, { ...options.client, ...middleware });
};
