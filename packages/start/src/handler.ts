/**
 * Serves an effect-trpc router from a TanStack Start server route (`src/routes/api/rpc.$.ts`).
 *
 * {@link createStartHandler} wraps `@rpc-effect/server`'s `toWebHandler` (an `effect/rpc` HTTP
 * server) in the `({ request }) => Promise<Response>` shape of Start's `server.handlers`. Browser
 * clients (`createBrowserClient`, the browser half of `createIsomorphicClient`) call it; server
 * code usually runs the router in-process instead. Server-only.
 *
 * @since 0.1.0
 */
import { Router } from '@rpc-effect/core';
import { toWebHandler } from '@rpc-effect/server';
import type { WebHandler, WebHandlerOptions } from '@rpc-effect/server';

/**
 * The default rpc path of a TanStack Start app: `"/api/rpc"` (`src/routes/api/rpc.$.ts`).
 *
 * **When to use**
 *
 * Use it instead of repeating the literal when you build urls to the default endpoint;
 * `createStartHandler`, `createBrowserClient` and `getRpcUrl` already default to it.
 *
 * **Example** (Resolving the default endpoint)
 *
 * ```ts
 * // src/rpc/urls.ts — server or browser
 * import { defaultStartPath, getRpcUrl } from '@rpc-effect/start';
 *
 * // `http://localhost:3000/api/rpc` during SSR in dev, the page origin in the browser.
 * export const rpcUrl: URL = getRpcUrl(defaultStartPath);
 * ```
 *
 * @see {@link createStartHandler}
 * @category utils
 * @since 0.1.0
 */
export const defaultStartPath = '/api/rpc' as const;

/**
 * Options of {@link createStartHandler}: the `toWebHandler` options (`handlers` required,
 * `serialization`, `disableTracing`, `spanPrefix`, `concurrency`, `onError`) plus the mount
 * `path`.
 *
 * **Gotchas**
 *
 * - `serialization` (default `"ndjson"`) must match the client's.
 *
 * @see {@link createStartHandler}
 * @category options
 * @since 0.1.0
 */
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

/**
 * The part of TanStack Start's server route handler context the rpc handler uses.
 *
 * @category models
 * @since 0.1.0
 */
export interface StartHandlerContext {
  /** The incoming Web `Request`. */
  readonly request: Request;
}

/**
 * A TanStack Start server route handler (`server.handlers.POST` of `createFileRoute`) serving a
 * router. Also callable directly with `{ request }` (tests, other fetch runtimes).
 *
 * @see {@link createStartHandler}
 * @category models
 * @since 0.1.0
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

/** `createStartHandler` for a router. */
const createStartHandlerFor = <R extends Router.Any, LE = never>(
  router: R,
  options: StartHandlerOptions<R, LE>,
): StartHandler => {
  const path = normalizePath(options.path ?? defaultStartPath);
  let web: Promise<WebHandler> | undefined;
  let disposed: Promise<void> | undefined;

  const build = (): Promise<WebHandler> => {
    web ??= toWebHandler(router, { ...options, path }).catch((error: unknown) => {
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

/** `createStartHandler` for a router or a router service: normalises the input with `Router.from`. */
const createStartHandlerFromInput = (
  input: Router.Input,
  options: StartHandlerOptions<Router.Any>,
): unknown => {
  const router: Router.Any = Router.from(input);
  return createStartHandlerFor(router, options);
};

/**
 * Creates a TanStack Start server route handler for a router: mount it on a catch-all server
 * route (`src/routes/api/rpc.$.ts`).
 *
 * **When to use**
 *
 * Use it once per app so browser code (`createBrowserClient`, or the browser half of
 * `createIsomorphicClient`) can reach the router over HTTP. Loaders and SSR do not need it: they
 * run in-process through `createServerClient` / `createIsomorphicClient`.
 *
 * **Details**
 *
 * - `router` is a `Router.make` router or a router service class (`Router.Input`); a service is
 *   normalised with `Router.from` (its `make` runs once per process) and typed as `Router.Of<X>`.
 * - The effect-trpc web handler (`toWebHandler`) is built lazily, once, on the first request
 *   (so importing the route module does not build the handler layer). A failed build rejects
 *   that request (Start answers `500`) and is retried on the next one.
 * - Requests to `path` or below (`/api/rpc/anything`, query string kept) are rewritten to
 *   `path`; other paths get a `404` JSON body.
 * - The `effect/rpc` HTTP protocol only uses `POST`: any other method gets a `405` JSON body with
 *   `Allow: POST`, so registering the handler under `GET` too is safe.
 * - Typed failures and defects are encoded into the response `Exit` (status `200`), exactly like
 *   `toWebHandler`; subscriptions stream NDJSON chunks. Clients decode them to
 *   `ClientError<E>` (`E | RpcDefect | RpcTransportError | RpcInterrupted`).
 * - After `dispose()` every request gets a plain-text `503`.
 *
 * **Gotchas**
 *
 * - `path` is the route path **without** the `$` splat, including the router `basepath` if any;
 *   a mismatch answers every call with `404`.
 * - `serialization` must match the client's (`"ndjson"` by default on both sides).
 * - The route module imports your handlers: keep it (and `handlers.server.ts`) out of modules the
 *   browser bundle loads.
 *
 * **Example** (src/routes/api/rpc.$.ts, server only)
 *
 * ```ts
 * // src/routes/api/rpc.$.ts — server route
 * import { query, Router } from '@rpc-effect/core';
 * import { createStartHandler } from '@rpc-effect/start';
 * import { Handlers } from '@rpc-effect/server';
 * import { createRootRoute, createRoute } from '@tanstack/react-router';
 * import type {} from '@tanstack/react-start'; // adds the `server` route option (types only)
 * import { Effect, Schema } from 'effect';
 *
 * // src/rpc/router.ts (shared) and src/rpc/handlers.server.ts (server only) in a real app
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * const HandlersLive = Handlers.make(appRouter, {
 *   post: {
 *     byId: ({ id }) =>
 *       id === 1
 *         ? Effect.succeed(new Post({ id, title: 'Hello' }))
 *         : Effect.fail(new PostNotFound({ id })),
 *   },
 * });
 *
 * // `path` defaults to '/api/rpc': the route path without the `$` splat.
 * const handler = createStartHandler(appRouter, { handlers: HandlersLive });
 *
 * // File-based routing: `export const Route = createFileRoute('/api/rpc/$')({ server: ... })`
 * // with the same `server` option (the generated route tree registers the path).
 * const rootRoute = createRootRoute();
 * export const Route = createRoute({
 *   getParentRoute: () => rootRoute,
 *   path: '/api/rpc/$',
 *   // GET answers 405 + `Allow: POST`: a clear answer for someone opening the url in a browser.
 *   server: { handlers: { POST: handler, GET: handler } },
 * });
 * ```
 *
 * @see {@link StartHandlerOptions}
 * @see {@link createIsomorphicClient} for the client side
 * @category adapters
 * @since 0.1.0
 */
export const createStartHandler: {
  <R extends Router.Any, LE = never>(router: R, options: StartHandlerOptions<R, LE>): StartHandler;
  <X extends Router.Input, LE = never>(
    router: X,
    options: StartHandlerOptions<Router.Of<X>, LE>,
  ): StartHandler;
} =
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- both overloads normalise the input with `Router.from` and continue with that router, which is what the implementation does; checking the overloads against it structurally instantiates `Router.Of<Router.Input>`, which is too deep
  createStartHandlerFromInput as unknown as typeof createStartHandler;
