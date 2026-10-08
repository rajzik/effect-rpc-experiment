import type { Router } from '@effect-trpc/core';
import { toWebHandler } from '@effect-trpc/server';
import type { WebHandler, WebHandlerOptions } from '@effect-trpc/server';

/** The default rpc path of a TanStack Start app (`src/routes/api/rpc.$.ts`). */
export const defaultStartPath = '/api/rpc' as const;

/** Options of {@link createStartHandler}. */
export interface StartHandlerOptions<R extends Router.Any, LE = never> extends Omit<
  WebHandlerOptions<R, LE>,
  'path'
> {
  /**
   * The url path the rpc route is mounted on, i.e. the server route file path without the
   * catch-all segment: `src/routes/api/rpc.$.ts` (`createFileRoute('/api/rpc/$')`) → `"/api/rpc"`
   * (the default). Requests to this path or to any path below it (`/api/rpc/post.byId`, ...)
   * are served; requests to other paths get a `404`. Include your router `basepath`, if any.
   */
  readonly path?: string | undefined;
}

/** The part of TanStack Start's server route handler context the rpc handler uses. */
export interface StartHandlerContext {
  readonly request: Request;
}

/**
 * A TanStack Start server route handler (`server.handlers.POST` of `createFileRoute`) serving a
 * router. Also callable directly with `{ request }` (tests, other fetch runtimes).
 */
export interface StartHandler {
  (ctx: StartHandlerContext): Promise<Response>;
  /**
   * Releases the handler layer (finalizers run) and shuts the rpc server down. Requests received
   * afterwards are answered with `503`. Idempotent.
   */
  readonly dispose: () => Promise<void>;
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}

/** Normalizes a mount path: leading `/`, no trailing `/` (`"api/rpc/"` → `"/api/rpc"`). */
const normalizePath = (path: string): `/${string}` => {
  const trimmed = path.replace(/^\/+|\/+$/g, '');
  return `/${trimmed}`;
};

const jsonResponse = (status: number, body: object, headers?: Record<string, string>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/**
 * Rewrites a request for the mount path or any path below it (the catch-all `$` splat) to the
 * mount path itself, where the rpc server listens. Returns `undefined` for other paths.
 */
const rewrite = (request: Request, path: `/${string}`): Request | undefined => {
  const url = new URL(request.url);
  if (url.pathname === path) return request;
  const isRoot = path === '/';
  if (!isRoot && !url.pathname.startsWith(`${path}/`)) return undefined;
  url.pathname = path;
  // Passing the original request as `init` keeps method, headers, signal and the (streamed) body.
  return new Request(url, request);
};

/**
 * Creates a TanStack Start server route handler for a router: mount it on a catch-all server
 * route (`src/routes/api/rpc.$.ts`).
 *
 * ```ts
 * const handler = createStartHandler(appRouter, { handlers: HandlersLive });
 * export const Route = createFileRoute('/api/rpc/$')({
 *   server: { handlers: { POST: handler, GET: handler } },
 * });
 * ```
 *
 * - The effect-trpc web handler (`toWebHandler`) is built lazily, once, on the first request
 *   (so importing the route module does not build the handler layer). A failed build rejects
 *   that request (Start answers `500`) and is retried on the next one.
 * - Requests to `path` or below (`/api/rpc/anything`) are rewritten to `path`; other paths get a
 *   `404` JSON body.
 * - The `effect/rpc` HTTP protocol only uses `POST`: any other method gets a `405` JSON body with
 *   `Allow: POST`, so registering the handler under `GET` too is safe.
 * - Typed failures and defects are encoded into the response `Exit` (status `200`), exactly like
 *   `toWebHandler`; subscriptions stream NDJSON chunks.
 */
export const createStartHandler = <R extends Router.Any, LE = never>(
  router: R,
  options: StartHandlerOptions<R, LE>,
): StartHandler => {
  const path = normalizePath(options.path ?? defaultStartPath);
  let web: Promise<WebHandler> | undefined;
  let disposed: Promise<void> | undefined;

  const build = (): Promise<WebHandler> => {
    web ??= toWebHandler(router, {
      handlers: options.handlers,
      path,
      serialization: options.serialization,
      disableTracing: options.disableTracing,
      spanPrefix: options.spanPrefix,
      concurrency: options.concurrency,
    }).catch((error: unknown) => {
      web = undefined;
      throw error;
    });
    return web;
  };

  const handle = async ({ request }: StartHandlerContext): Promise<Response> => {
    if (disposed !== undefined) return new Response('Server disposed', { status: 503 });
    if (request.method !== 'POST') {
      return jsonResponse(
        405,
        {
          _tag: 'MethodNotAllowed',
          message: `effect-trpc only accepts POST requests (got ${request.method})`,
        },
        { allow: 'POST' },
      );
    }
    const rewritten = rewrite(request, path);
    if (rewritten === undefined) {
      return jsonResponse(404, {
        _tag: 'NotFound',
        message: `No effect-trpc endpoint at ${new URL(request.url).pathname} (mounted on ${path})`,
      });
    }
    const { handler } = await build();
    return handler(rewritten);
  };

  const dispose = (): Promise<void> => {
    disposed ??= (async () => {
      const pending = web;
      if (pending === undefined) return;
      const built = await pending.catch(() => undefined);
      await built?.dispose();
    })();
    return disposed;
  };

  return Object.assign(handle, { dispose, [Symbol.asyncDispose]: dispose });
};
