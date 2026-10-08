import type { Router } from '@effect-trpc/core';
import { toWebHandler } from '@effect-trpc/server';
import type { Handlers, Serialization, WebHandler } from '@effect-trpc/server';
import type { Layer } from 'effect';

/** Options of {@link createRouteHandler}. */
export interface RouteHandlerOptions<R extends Router.Any, LE = never> {
  /**
   * Layer providing every handler of the router and the server implementation of every
   * middleware it uses (`Layer.mergeAll(HandlersLive, AuthLive)`), with no remaining requirements.
   * It is built once, on the first request.
   */
  readonly handlers: Layer.Layer<Handlers.Requirements<R>, LE>;
  /**
   * Path of the route handler, i.e. the folder of `route.ts` below `app/`. Defaults to
   * `"/api/rpc"` (`app/api/rpc/[[...rpc]]/route.ts` or `app/api/rpc/route.ts`). Requests below
   * it (`/api/rpc/anything`, added by a catch-all segment) are served by the same endpoint.
   */
  readonly path?: `/${string}` | undefined;
  /**
   * Next.js `basePath` (from `next.config`), when the app is served below a prefix. Requests are
   * accepted with and without it.
   */
  readonly basePath?: `/${string}` | undefined;
  /** Wire format, must match the client's `httpLink`. Defaults to `"ndjson"`. */
  readonly serialization?: Serialization | undefined;
}

/** A Next.js App Router request handler (`export const POST = ...` in `route.ts`). */
export type NextRouteHandlerFn = (request: Request) => Promise<Response>;

/** What {@link createRouteHandler} returns: the `route.ts` exports plus `dispose`. */
export interface RouteHandler {
  /** Answers `405 Method Not Allowed`: effect-trpc calls are always `POST`s. */
  readonly GET: NextRouteHandlerFn;
  /** Serves the rpc endpoint. */
  readonly POST: NextRouteHandlerFn;
  /**
   * Shuts the rpc server down and releases the handler layer (its finalizers run). Later
   * requests are answered with `503`. Idempotent.
   */
  readonly dispose: () => Promise<void>;
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}

const defaultPath = '/api/rpc';

const json = (status: number, body: unknown, headers?: Record<string, string>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const trimTrailingSlash = (path: string): string =>
  path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;

const isAtOrBelow = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/** effect-trpc clients only send `POST`s. */
const methodNotAllowed: NextRouteHandlerFn = (request) =>
  Promise.resolve(
    json(
      405,
      {
        _tag: 'MethodNotAllowed',
        message: `effect-trpc endpoints only accept POST requests (got ${request.method})`,
      },
      { allow: 'POST' },
    ),
  );

/**
 * Creates the `GET` / `POST` exports of a Next.js App Router route handler serving a router
 * (tRPC's `fetchRequestHandler` in `app/api/trpc/[trpc]/route.ts`):
 *
 * ```ts
 * // app/api/rpc/[[...rpc]]/route.ts
 * export const { GET, POST } = createRouteHandler(appRouter, { handlers: HandlersLive });
 * ```
 *
 * - The server (`toWebHandler`) is built lazily on the first request and shared by every later
 *   request. When building fails the request rejects and the next request tries again.
 * - Requests at or below `basePath + path` are rewritten to `path`, so a catch-all segment or a
 *   trailing slash does not matter. Other paths get a `404` JSON response.
 * - effect-trpc clients only send `POST`s; `GET` answers `405` with `Allow: POST`.
 */
export const createRouteHandler = <R extends Router.Any, LE = never>(
  router: R,
  options: RouteHandlerOptions<R, LE>,
): RouteHandler => {
  const path = trimTrailingSlash(options.path ?? defaultPath) as `/${string}`;
  const prefixes =
    options.basePath === undefined || options.basePath === '/'
      ? [path]
      : [`${trimTrailingSlash(options.basePath)}${path === '/' ? '' : path}`, path];

  let server: Promise<WebHandler> | undefined;
  let disposed: Promise<void> | undefined;

  const getServer = (): Promise<WebHandler> => {
    server ??= toWebHandler(router, {
      handlers: options.handlers,
      path,
      serialization: options.serialization,
    }).catch((error: unknown) => {
      // Let the next request retry instead of caching the failure forever.
      server = undefined;
      throw error;
    });
    return server;
  };

  const toEndpoint = async (request: Request): Promise<Request | Response> => {
    const url = new URL(request.url);
    const pathname = trimTrailingSlash(url.pathname);
    if (pathname === path) return request;
    if (!prefixes.some((prefix) => isAtOrBelow(pathname, prefix))) {
      return json(404, {
        _tag: 'NotFound',
        message: `No effect-trpc endpoint at ${url.pathname} (expected ${prefixes.join(' or ')})`,
      });
    }
    url.pathname = path;
    return new Request(url, {
      method: request.method,
      headers: request.headers,
      body: await request.arrayBuffer(),
      signal: request.signal,
    });
  };

  const POST: NextRouteHandlerFn = async (request) => {
    if (disposed !== undefined) return json(503, { _tag: 'Disposed', message: 'Server disposed' });
    const endpoint = await toEndpoint(request);
    if (endpoint instanceof Response) return endpoint;
    const web = await getServer();
    return web.handler(endpoint);
  };

  const dispose = (): Promise<void> => {
    disposed ??= (async () => {
      const pending = server;
      if (pending === undefined) return;
      const web = await pending.catch(() => undefined);
      await web?.dispose();
    })();
    return disposed;
  };

  return { GET: methodNotAllowed, POST, dispose, [Symbol.asyncDispose]: dispose };
};
