/**
 * Serves a router over HTTP: as a fetch handler (`toWebHandler`, built lazily by
 * `makeLazyWebHandler`) or as an Effect `HttpRouter` layer (`layerHttp`).
 *
 * Both are thin wrappers over `effect/rpc`'s `RpcServer.layerHttp` that always set
 * `disableFatalDefects: true` and default to `protocol: "http"` with NDJSON serialization, which
 * is what `httpLink` from `@rpc-effect/client` expects. The handler layer comes from
 * `Handlers.make`, merged with the router's middleware implementations. For a standalone Node
 * server see `@rpc-effect/server/node`.
 *
 * @since 0.1.0
 */
import { Layer, ManagedRuntime } from 'effect';
import type { Cause, Context, Effect } from 'effect';
import { HttpRouter } from 'effect/http';
import type { Headers } from 'effect/http';
import { RpcSerialization, RpcServer } from 'effect/rpc';
import type { Rpc, RpcGroup } from 'effect/rpc';
import { Router } from '@rpc-effect/core';
import type { Handlers } from './Handlers.js';
import { withHooks } from './internal/hooks.js';

/**
 * Wire format of the rpc endpoint: `"ndjson"` (default for HTTP; streams subscription chunks as
 * they are produced), `"json"` (one JSON array per response) or any `RpcSerialization` layer.
 *
 * **Gotchas**
 *
 * - Clients must use the same serialization (`httpLink({ serialization })`, or
 *   `RpcSerialization.layerNdjson` for a raw `effect/rpc` client). Keep `"ndjson"` when the
 *   router has subscriptions over HTTP.
 *
 * @see {@link serializationLayer}
 * @category options
 * @since 0.1.0
 */
export type Serialization = 'json' | 'ndjson' | Layer.Layer<RpcSerialization.RpcSerialization>;

/**
 * What the `onError` server option receives about a failed call (tRPC's `onError` options).
 *
 * **When to use**
 *
 * Use to log or report failures centrally: every call that fails while running (handler or
 * middleware, e.g. auth; typed failure or defect) is reported once, with its procedure path.
 *
 * **Details**
 *
 * - `cause` is the full `Cause` of the failure: typed errors are `Fail` reasons, defects `Die`
 *   reasons. Calls that are only interrupted (client abort, shutdown) are not reported.
 * - `headers` are the call's headers, request headers included. Rpc message headers (sent by
 *   the client) override HTTP request headers of the same name; read a header set by a trusted
 *   proxy from `HttpContext.request` instead.
 *
 * **Gotchas**
 *
 * - Calls `RpcServer` rejects outside the handler and middleware are not reported: a payload
 *   that fails to decode, an unknown procedure, a success value that fails to encode. They reach
 *   the client as `RpcDefect`.
 * - The failure is sent once `onError` completes and the hook is not interrupted (not even by a
 *   client abort), so a slow hook delays the response and a hanging hook also blocks `dispose()`
 *   / server shutdown for that call; fork long work. Failures and defects of the hook itself are
 *   ignored and never change the response.
 *
 * **Example** (Logging failed calls)
 *
 * ```ts
 * import { Cause, Effect, Schema } from 'effect';
 * import { query, Router } from '@rpc-effect/core';
 * import { Handlers, toWebHandler } from '@rpc-effect/server';
 * import type { OnErrorInfo } from '@rpc-effect/server';
 *
 * class NotFound extends Schema.TaggedError<NotFound>()('NotFound', {}) {}
 * const appRouter = Router.make({ post: query({ success: Schema.String, error: NotFound }) });
 * const HandlersLive = Handlers.make(appRouter, { post: () => Effect.fail(new NotFound()) });
 *
 * const onError = ({ path, cause, headers }: OnErrorInfo) =>
 *   Effect.logError(`${path} failed (user ${headers['x-user'] ?? '-'})`, Cause.pretty(cause));
 *
 * const { handler } = await toWebHandler(appRouter, { handlers: HandlersLive, onError });
 * ```
 *
 * @see {@link ServerOptions}
 * @category models
 * @since 0.1.0
 */
export interface OnErrorInfo {
  /** The procedure path, e.g. `"post.byId"`. */
  readonly path: string;
  /** Why the call failed. Never interrupt-only. */
  readonly cause: Cause.Cause<unknown>;
  /**
   * The call's headers: the HTTP request headers plus the rpc message headers, which win on a
   * name clash.
   */
  readonly headers: Headers.Headers;
}

/**
 * Options shared by the HTTP adapters (`layerHttp`, `toWebHandler`, `serve`, `runServer`).
 *
 * **Gotchas**
 *
 * - `path` must match the URL path the requests arrive at; other paths answer `404`. Mounting
 *   the fetch handler at `app/api/rpc/route.ts` in Next.js needs `path: "/api/rpc"`.
 *
 * @category options
 * @since 0.1.0
 */
export interface ServerOptions {
  /** Route of the rpc endpoint. Defaults to `"/rpc"`. */
  readonly path?: HttpRouter.PathInput | undefined;
  /** Wire format, for every protocol. Defaults to `"ndjson"`, like `httpLink` and `wsLink`. */
  readonly serialization?: Serialization | undefined;
  /** Disables the server spans `RpcServer` creates for every request. */
  readonly disableTracing?: boolean | undefined;
  /** Prefix of the server span names. */
  readonly spanPrefix?: string | undefined;
  /** Maximum number of requests handled concurrently. Defaults to `"unbounded"`. */
  readonly concurrency?: number | 'unbounded' | undefined;
  /**
   * Called for every call that fails while running (handler or middleware; typed failure or
   * defect), before the failure is sent; not for interruptions, nor for calls rejected before or
   * after running (invalid payload, unknown procedure, unencodable success). Its own failures are
   * ignored. See {@link OnErrorInfo}.
   */
  readonly onError?: ((error: OnErrorInfo) => Effect.Effect<void>) | undefined;
}

/**
 * Options of {@link layerHttp}.
 *
 * @category options
 * @since 0.1.0
 */
export interface LayerHttpOptions<LOut, LE, LR> extends ServerOptions {
  /**
   * The handler layer (e.g. from `Handlers.make`), merged with the server implementations of the
   * router's middleware. Optional: whatever it does not provide stays a requirement of the
   * returned layer.
   */
  readonly handlers?: Layer.Layer<LOut, LE, LR> | undefined;
  /**
   * Transport. Defaults to `"http"` (request/response, POST). `"websocket"` serves a websocket
   * endpoint on the same path.
   */
  readonly protocol?: 'http' | 'websocket' | undefined;
}

/**
 * Options of {@link toWebHandler}.
 *
 * @category options
 * @since 0.1.0
 */
export interface WebHandlerOptions<R extends Router.Any, LE> extends ServerOptions {
  /**
   * Layer providing every handler of the router and the server implementation of every
   * middleware it uses (`Layer.mergeAll(HandlersLive, AuthLive)`), with no remaining
   * requirements.
   */
  readonly handlers: Layer.Layer<Handlers.Requirements<R>, LE>;
}

/**
 * A fetch-style request handler (`Request` → `Response`) returned by {@link toWebHandler}.
 *
 * **Details**
 *
 * - `dispose()` is idempotent and also available as `await using web = await toWebHandler(...)`.
 *
 * @category models
 * @since 0.1.0
 */
export interface WebHandler {
  /** Answers a fetch `Request`. Mount it on `path` (default `"/rpc"`) of any fetch runtime. */
  readonly handler: (request: Request) => Promise<Response>;
  /**
   * Shuts the rpc server down and releases the handler layer (finalizers run). Requests
   * received afterwards are answered with `503`.
   */
  readonly dispose: () => Promise<void>;
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}

const defaultPath = '/rpc' as const;

/**
 * Resolves a {@link Serialization} option to an `RpcSerialization` layer.
 *
 * **When to use**
 *
 * Use when wiring `RpcServer` or `RpcClient` from `effect/rpc` by hand and you want the same
 * option values as the adapters. `fallback` is used when `serialization` is `undefined`.
 *
 * **Example** (Matching a raw `effect/rpc` server to the adapters' default)
 *
 * ```ts
 * import { RpcSerialization } from 'effect/rpc';
 * import { serializationLayer } from '@rpc-effect/server';
 *
 * const ndjson = serializationLayer(undefined); // RpcSerialization.layerNdjson
 * const json = serializationLayer(undefined, 'json'); // RpcSerialization.layerJson
 * const custom = serializationLayer(RpcSerialization.layerNdjsonWith());
 * ```
 *
 * @category utils
 * @since 0.1.0
 */
export const serializationLayer = (
  serialization: Serialization | undefined,
  fallback: 'json' | 'ndjson' = 'ndjson',
): Layer.Layer<RpcSerialization.RpcSerialization> => {
  const value = serialization ?? fallback;
  if (value === 'ndjson') return RpcSerialization.layerNdjson;
  if (value === 'json') return RpcSerialization.layerJson;
  return value;
};

/** `layerHttp` for a router. */
const layerHttpFor = <R extends Router.Any, LOut = never, LE = never, LR = never>(
  router: R,
  options: LayerHttpOptions<LOut, LE, LR> = {},
): Layer.Layer<never, LE, HttpRouter.HttpRouter | LR | Exclude<Handlers.Requirements<R>, LOut>> => {
  const protocol = options.protocol ?? 'http';
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `Router.Any` erases the group's rpcs on purpose; the return type below restores them via `Handlers.Requirements<R>`
  const hooks = withHooks(router.group as RpcGroup.RpcGroup<Rpc.Any>, options);
  const server = RpcServer.layerHttp({
    group: hooks.group,
    path: options.path ?? defaultPath,
    protocol,
    disableFatalDefects: true,
    disableTracing: options.disableTracing,
    spanPrefix: options.spanPrefix,
    concurrency: options.concurrency,
  }).pipe(Layer.provide([serializationLayer(options.serialization), hooks.layer]));
  return options.handlers === undefined ? server : server.pipe(Layer.provide(options.handlers));
};

/** `layerHttp` for a router or a router service: normalises the input with `Router.from`. */
const layerHttpFromInput = (
  input: Router.Input,
  options?: LayerHttpOptions<never, never, never>,
): unknown => {
  const router: Router.Any = Router.from(input);
  return layerHttpFor(router, options);
};

/**
 * Serves a router on an Effect `HttpRouter` route, for composing into an existing Effect HTTP
 * application (`HttpRouter.serve`, `HttpRouter.toWebHandler`, ...).
 *
 * **When to use**
 *
 * Use when the rpc endpoint is one route of a larger Effect HTTP app, or for a WebSocket
 * endpoint (`protocol: "websocket"`, for `wsLink`). Prefer {@link toWebHandler} for a fetch
 * runtime and `runServer` / `serve` from `@rpc-effect/server/node` for a standalone server.
 *
 * **Details**
 *
 * - `router` is a `Router.make` router or a router service class (`Router.Input`); a service is
 *   normalised with `Router.from` (its `make` runs once per process) and typed as `Router.Of<X>`.
 * - A thin wrapper over `RpcServer.layerHttp` that defaults to `protocol: "http"` and always
 *   sets `disableFatalDefects: true`, so a defect in one handler fails only that call instead of
 *   the whole connection.
 * - The serialization layer is provided (default `"ndjson"` for both protocols, matching `httpLink` / `wsLink`),
 *   and so is `handlers` when given. Whatever `handlers` does not provide stays a requirement of
 *   the returned layer, together with `HttpRouter`.
 * - A handlers layer made with `Handlers.withContext` gets its request context per call (over
 *   HTTP and WebSocket); `onError` reports the calls that fail.
 *
 * **Example** (Mounting the rpc route next to other routes on a Node server)
 *
 * ```ts
 * import { createServer } from 'node:http';
 * import { Effect, Layer, Schema } from 'effect';
 * import { HttpRouter, HttpServerResponse } from 'effect/http';
 * import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
 * import { query, Router } from '@rpc-effect/core';
 * import { Handlers, layerHttp } from '@rpc-effect/server';
 *
 * const appRouter = Router.make({ health: query({ success: Schema.Literal('ok') }) });
 * const HandlersLive = Handlers.make(appRouter, { health: () => Effect.succeed('ok' as const) });
 *
 * const RpcRoute = layerHttp(appRouter, { handlers: HandlersLive, path: '/api/rpc' });
 * const HealthRoute = HttpRouter.add('GET', '/health', Effect.succeed(HttpServerResponse.text('up')));
 *
 * HttpRouter.serve(Layer.mergeAll(RpcRoute, HealthRoute)).pipe(
 *   Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
 *   Layer.launch,
 *   NodeRuntime.runMain,
 * );
 * ```
 *
 * @see {@link toWebHandler}
 * @category adapters
 * @since 0.1.0
 */
export const layerHttp: {
  <R extends Router.Any, LOut = never, LE = never, LR = never>(
    router: R,
    options?: LayerHttpOptions<LOut, LE, LR>,
  ): Layer.Layer<never, LE, HttpRouter.HttpRouter | LR | Exclude<Handlers.Requirements<R>, LOut>>;
  <X extends Router.Input, LOut = never, LE = never, LR = never>(
    router: X,
    options?: LayerHttpOptions<LOut, LE, LR>,
  ): Layer.Layer<
    never,
    LE,
    HttpRouter.HttpRouter | LR | Exclude<Handlers.Requirements<Router.Of<X>>, LOut>
  >;
} =
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- both overloads normalise the input with `Router.from` and continue with that router, which is what the implementation does; checking the overloads against it structurally instantiates `Router.Of<Router.Input>`, which is too deep
  layerHttpFromInput as unknown as typeof layerHttp;

/**
 * Alias of {@link layerHttp}.
 *
 * **Example** (Same as `layerHttp`)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@rpc-effect/core';
 * import { Handlers, toHttpLayer } from '@rpc-effect/server';
 *
 * const appRouter = Router.make({ ping: query({ success: Schema.String }) });
 * const RpcRoute = toHttpLayer(appRouter, {
 *   handlers: Handlers.make(appRouter, { ping: () => Effect.succeed('pong') }),
 * });
 * ```
 *
 * @see {@link layerHttp}
 * @category adapters
 * @since 0.1.0
 */
export const toHttpLayer = layerHttp;

/** `toWebHandler` for a router. */
const toWebHandlerFor = async <R extends Router.Any, LE = never>(
  router: R,
  options: WebHandlerOptions<R, LE>,
): Promise<WebHandler> => {
  const runtime = ManagedRuntime.make(options.handlers);
  let context: Context.Context<Handlers.Requirements<R>>;
  try {
    context = await runtime.context();
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
  const app = layerHttp(router, {
    ...options,
    protocol: 'http',
    handlers: Layer.succeedContext(context),
  }) as Layer.Layer<never, never, HttpRouter.HttpRouter>;
  const web = HttpRouter.toWebHandler(app, { disableLogger: true });
  let disposed: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    disposed ??= web.dispose().finally(() => runtime.dispose());
    return disposed;
  };
  return {
    // After dispose() the underlying handler would wait forever: answer 503 instead.
    handler: (request) =>
      disposed === undefined
        ? web.handler(request)
        : Promise.resolve(new Response('Server disposed', { status: 503 })),
    dispose,
    [Symbol.asyncDispose]: dispose,
  };
};

/** `toWebHandler` for a router or a router service: normalises the input with `Router.from`. */
const toWebHandlerFromInput = (
  input: Router.Input,
  options: WebHandlerOptions<Router.Any, never>,
): unknown => {
  const router: Router.Any = Router.from(input);
  return toWebHandlerFor(router, options);
};

/**
 * Builds a fetch handler (`(request: Request) => Promise<Response>`) serving a router over HTTP,
 * for any fetch runtime: Next.js route handlers, TanStack Start server routes, Bun, Deno,
 * Cloudflare Workers, Hono, ...
 *
 * **When to use**
 *
 * Use to expose a router to `httpLink` clients from a platform that speaks `Request` /
 * `Response`. Prefer {@link layerHttp} inside an Effect HTTP app and `runServer` from
 * `@rpc-effect/server/node` for a standalone Node server.
 *
 * **Details**
 *
 * - `router` is a `Router.make` router or a router service class (`Router.Input`); a service is
 *   normalised with `Router.from` (its `make` runs once per process) and typed as `Router.Of<X>`.
 * - The handler layer is built eagerly, so the returned promise rejects with the layer's error
 *   when it fails to build, and the layer is shared by all requests until `dispose()`.
 * - The endpoint always uses `protocol: "http"` and `disableFatalDefects: true`: typed failures
 *   and defects are encoded into the response `Exit` and later requests keep working. Request
 *   headers reach middleware and handlers as `headers`.
 * - `dispose()` interrupts in-flight requests, runs the layer's finalizers and makes later
 *   requests answer `503`.
 *
 * **Gotchas**
 *
 * - `path` (default `"/rpc"`) must equal the pathname the platform routes to the handler;
 *   any other path answers `404`.
 * - `handlers` must provide every handler and middleware implementation with no remaining
 *   requirements; provide services (database, config) to it first.
 *
 * **Example** (A Next.js App Router route handler)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@rpc-effect/core';
 * import { Handlers, toWebHandler } from '@rpc-effect/server';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post }) },
 * });
 * const HandlersLive = Handlers.make(appRouter, {
 *   post: { byId: ({ id }) => Effect.succeed(new Post({ id, title: 'Hello' })) },
 * });
 *
 * // app/api/rpc/route.ts: the path must match the route's URL.
 * const { handler } = await toWebHandler(appRouter, { handlers: HandlersLive, path: '/api/rpc' });
 * export const POST = handler;
 * ```
 *
 * @see {@link layerHttp}
 * @see {@link WebHandler}
 * @category adapters
 * @since 0.1.0
 */
export const toWebHandler: {
  <R extends Router.Any, LE = never>(
    router: R,
    options: WebHandlerOptions<R, LE>,
  ): Promise<WebHandler>;
  <X extends Router.Input, LE = never>(
    router: X,
    options: WebHandlerOptions<Router.Of<X>, LE>,
  ): Promise<WebHandler>;
} =
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- both overloads normalise the input with `Router.from` and continue with that router, which is what the implementation does; checking the overloads against it structurally instantiates `Router.Of<Router.Input>`, which is too deep
  toWebHandlerFromInput as unknown as typeof toWebHandler;

/**
 * A {@link WebHandler} built on first use and shared after that, returned by
 * {@link makeLazyWebHandler}.
 *
 * @see {@link makeLazyWebHandler}
 * @category models
 * @since 0.1.0
 */
export interface LazyWebHandler {
  /** `true` once `dispose()` has been called, even while that disposal is still running. */
  readonly isDisposed: () => boolean;
  /**
   * Resolves the shared {@link WebHandler}, building it on the first call. Concurrent calls share
   * one build; a failed build rejects its callers and the next call builds again. Rejects after
   * `dispose()`.
   */
  readonly get: () => Promise<WebHandler>;
  /**
   * Closes the owner (no build ever starts again), waits for a pending build and disposes the
   * built handler once. Idempotent: every call returns the same promise.
   */
  readonly dispose: () => Promise<void>;
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}

/**
 * Wraps a {@link toWebHandler} build in a lazy, shared, disposable owner: the lifecycle behind
 * framework adapters (`createRouteHandler` in `@rpc-effect/next`, `createStartHandler` in
 * `@rpc-effect/start`).
 *
 * **When to use**
 *
 * Use when writing an adapter for a runtime that loads the route module before it serves
 * requests and should not build the handler layer at import time. Prefer {@link toWebHandler}
 * directly when building eagerly at startup is fine.
 *
 * **Details**
 *
 * - Creating the owner calls nothing; `get()` calls `build` once and every caller shares that
 *   attempt and, after it succeeds, its result.
 * - A failed build rejects the callers waiting for it and is not cached: the next `get()` while
 *   the owner is open builds again.
 * - `dispose()` closes the owner synchronously (`isDisposed()` turns `true` and `get()` rejects),
 *   then waits for a pending build and disposes its result exactly once. Before the first `get()`
 *   it builds nothing. It rejects with the built handler's disposal error, on every call.
 *
 * **Gotchas**
 *
 * - Check `isDisposed()` before `get()` to answer requests after `dispose()` (for example
 *   with `503`): `get()` rejects then. Callers that received the handler before `dispose()` keep
 *   using it; the disposed `WebHandler` answers them with `503`.
 *
 * **Example** (A fetch adapter that builds the server on the first request)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@rpc-effect/core';
 * import { Handlers, makeLazyWebHandler, toWebHandler } from '@rpc-effect/server';
 *
 * const appRouter = Router.make({ health: query({ success: Schema.String }) });
 * const HandlersLive = Handlers.make(appRouter, { health: () => Effect.succeed('ok') });
 *
 * const web = makeLazyWebHandler(() => toWebHandler(appRouter, { handlers: HandlersLive }));
 *
 * export const fetchHandler = async (request: Request): Promise<Response> => {
 *   if (web.isDisposed()) return new Response('Server disposed', { status: 503 });
 *   const { handler } = await web.get();
 *   return handler(request);
 * };
 * export const dispose = web.dispose;
 * ```
 *
 * @see {@link toWebHandler}
 * @see {@link LazyWebHandler}
 * @category adapters
 * @since 0.1.0
 */
export const makeLazyWebHandler = (build: () => Promise<WebHandler>): LazyWebHandler => {
  let web: Promise<WebHandler> | undefined;
  let disposed: Promise<void> | undefined;

  const get = (): Promise<WebHandler> => {
    if (disposed !== undefined) return Promise.reject(new Error('Web handler disposed'));
    web ??= build().catch((error: unknown) => {
      // Let the next call retry instead of caching the failure forever.
      web = undefined;
      throw error;
    });
    return web;
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

  return { isDisposed: () => disposed !== undefined, get, dispose, [Symbol.asyncDispose]: dispose };
};
