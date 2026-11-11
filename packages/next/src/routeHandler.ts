/**
 * Serves an effect-trpc router from a Next.js App Router route handler (`route.ts`).
 *
 * {@link createRouteHandler} wraps `@rpc-effect/server`'s `toWebHandler` (an `effect/rpc` HTTP
 * server) in the `GET` / `POST` exports Next expects. Browser clients created with
 * `createNextRpcClient` (or any `httpLink`) call it; server components usually skip it and run
 * the router in-process through `createRscHelpers`. Server-only.
 *
 * @since 0.1.0
 */
import { Router } from '@rpc-effect/core';
import { makeLazyWebHandler, toWebHandler } from '@rpc-effect/server';
import type { WebHandlerOptions } from '@rpc-effect/server';

/**
 * Options of {@link createRouteHandler}: `handlers`, `serialization` and `onError` of
 * `toWebHandler`, plus the mount `path` and `basePath`.
 *
 * **Details**
 *
 * - `handlers` is required and built once, on the first request; `path` defaults to
 *   `"/api/rpc"`; `serialization` defaults to `"ndjson"` and must match the client.
 *
 * @see {@link createRouteHandler}
 * @category options
 * @since 0.1.0
 */
export interface RouteHandlerOptions<R extends Router.Any, LE = never> extends Pick<
  WebHandlerOptions<R, LE>,
  'handlers' | 'serialization' | 'onError'
> {
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
}

/**
 * A Next.js App Router request handler (`export const POST = ...` in `route.ts`).
 *
 * **Details**
 *
 * - Typed with the Web `Request`, so the package never imports `next` at runtime; `NextRequest`
 *   extends `Request`, so Next accepts it.
 *
 * @category models
 * @since 0.1.0
 */
export type NextRouteHandlerFn = (request: Request) => Promise<Response>;

/**
 * What {@link createRouteHandler} returns: the `route.ts` exports plus `dispose`.
 *
 * **Details**
 *
 * - Export only `GET` and `POST` from `route.ts` (Next's build type-checks route file exports);
 *   keep the whole object in a non-exported binding when you also need `dispose`.
 *
 * @see {@link createRouteHandler}
 * @category models
 * @since 0.1.0
 */
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

/** `trimTrailingSlash` for a mount path: the result still starts with `/`. */
const trimMountPath = (path: `/${string}`): `/${string}` =>
  path.length > 1 && path.endsWith('/') ? `/${path.slice(1, -1)}` : path;

const isAtOrBelow = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(prefix === '/' ? prefix : `${prefix}/`);

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

/** `createRouteHandler` for a router. */
const createRouteHandlerFor = <R extends Router.Any, LE = never>(
  router: R,
  options: RouteHandlerOptions<R, LE>,
): RouteHandler => {
  const path = trimMountPath(options.path ?? defaultPath);
  const prefixes =
    options.basePath === undefined || options.basePath === '/'
      ? [path]
      : [`${trimTrailingSlash(options.basePath)}${path === '/' ? '' : path}`, path];

  const server = makeLazyWebHandler(() => toWebHandler(router, { ...options, path }));

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
    const endpoint = await toEndpoint(request);
    if (endpoint instanceof Response) return endpoint;
    // Checked after the await (not before): `dispose()` may have run while the body was read.
    if (server.isDisposed()) return json(503, { _tag: 'Disposed', message: 'Server disposed' });
    const web = await server.get();
    return web.handler(endpoint);
  };

  return {
    GET: methodNotAllowed,
    POST,
    dispose: server.dispose,
    [Symbol.asyncDispose]: server.dispose,
  };
};

/** `createRouteHandler` for a router or a router service: normalises the input with `Router.from`. */
const createRouteHandlerFromInput = (
  input: Router.Input,
  options: RouteHandlerOptions<Router.Any>,
): unknown => {
  const router: Router.Any = Router.from(input);
  return createRouteHandlerFor(router, options);
};

/**
 * Creates the `GET` / `POST` exports of a Next.js App Router route handler serving a router
 * (tRPC's `fetchRequestHandler` in `app/api/trpc/[trpc]/route.ts`).
 *
 * **When to use**
 *
 * Use it in `app/api/rpc/[[...rpc]]/route.ts` so client components (`createNextRpcClient`,
 * `httpLink`) can reach the router over HTTP. Server components and server actions do not need
 * it: prefer `createRscHelpers({ handlers })` / `createServerActionCaller`, which run in-process.
 *
 * **Details**
 *
 * - `router` is a `Router.make` router or a router service class (`Router.Input`); a service is
 *   normalised with `Router.from` (its `make` runs once per process) and typed as `Router.Of<X>`.
 * - The server (`toWebHandler`) is built lazily on the first request and shared by every later
 *   request. When building fails, that request rejects (Next answers `500`) and the next request
 *   tries again.
 * - Requests at or below `basePath + path` (or `path`) are rewritten to `path`, so a catch-all
 *   segment or a trailing slash does not matter. Other paths get a `404` JSON body.
 * - effect-trpc clients send every call, subscriptions included (NDJSON stream), as a `POST`;
 *   `GET` always answers `405` with `Allow: POST`.
 * - Typed failures and defects are encoded into the response `Exit`, exactly like
 *   `toWebHandler`; the client decodes them to `ClientError<E>`
 *   (`E | RpcDefect | RpcTransportError | RpcInterrupted`).
 * - After `dispose()` every `POST` answers `503`.
 *
 * **Gotchas**
 *
 * - `serialization` must match the client's (`createNextRpcClient` / `httpLink`), both default to
 *   `"ndjson"`.
 * - Set `path` when the route file is not under `app/api/rpc/`, and `basePath` when
 *   `next.config` has one; otherwise requests get the JSON `404`.
 * - The handler layer must be fully provided (middleware implementations included); it is a
 *   server-only module, keep secrets and database access out of files client components import.
 * - In dev, each HMR re-evaluation of `route.ts` creates a new server; the old one is not
 *   disposed.
 *
 * **Example** (The route file of an App Router app, server only)
 *
 * ```ts
 * // app/api/rpc/[[...rpc]]/route.ts
 * import { query, Router } from '@rpc-effect/core';
 * import { createRouteHandler } from '@rpc-effect/next';
 * import { Handlers } from '@rpc-effect/server';
 * import { Effect, Schema } from 'effect';
 *
 * // server/router.ts in a real app (schemas only, shared with client components)
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 *
 * // server/handlers.ts in a real app (`import 'server-only'`)
 * const HandlersLive = Handlers.make(appRouter, {
 *   post: {
 *     byId: ({ id }) =>
 *       id === 1
 *         ? Effect.succeed(new Post({ id, title: 'Hello' }))
 *         : Effect.fail(new PostNotFound({ id })),
 *   },
 * });
 *
 * // Only GET and POST are exported; GET answers 405 so probes get a clear error.
 * export const { GET, POST } = createRouteHandler(appRouter, { handlers: HandlersLive });
 * ```
 *
 * **Example** (A custom path below a Next.js `basePath`)
 *
 * ```ts
 * // app/rpc/[...rpc]/route.ts, with `basePath: '/docs'` in next.config
 * import { query, Router } from '@rpc-effect/core';
 * import { createRouteHandler } from '@rpc-effect/next';
 * import { Handlers } from '@rpc-effect/server';
 * import { Effect, Schema } from 'effect';
 *
 * const appRouter = Router.make({ health: query({ success: Schema.String }) });
 * const HandlersLive = Handlers.make(appRouter, { health: () => Effect.succeed('ok') });
 *
 * const handler = createRouteHandler(appRouter, {
 *   handlers: HandlersLive,
 *   path: '/rpc', // the folder of route.ts below app/
 *   basePath: '/docs', // `/docs/rpc` and `/rpc` are both accepted
 *   serialization: 'json', // the client must use `serialization: 'json'` too
 * });
 * export const { GET, POST } = handler;
 * ```
 *
 * @see {@link RouteHandlerOptions}
 * @see {@link createNextRpcClient} for the client half
 * @category adapters
 * @since 0.1.0
 */
export const createRouteHandler: {
  <R extends Router.Any, LE = never>(router: R, options: RouteHandlerOptions<R, LE>): RouteHandler;
  <X extends Router.Input, LE = never>(
    router: X,
    options: RouteHandlerOptions<Router.Of<X>, LE>,
  ): RouteHandler;
} =
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- both overloads normalise the input with `Router.from` and continue with that router, which is what the implementation does; checking the overloads against it structurally instantiates `Router.Of<Router.Input>`, which is too deep
  createRouteHandlerFromInput as unknown as typeof createRouteHandler;
