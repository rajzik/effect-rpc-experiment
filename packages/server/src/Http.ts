import { Layer, ManagedRuntime } from 'effect';
import type { Context } from 'effect';
import { HttpRouter } from 'effect/http';
import { RpcSerialization, RpcServer } from 'effect/rpc';
import type { Rpc, RpcGroup } from 'effect/rpc';
import type { Router } from '@effect-trpc/core';
import type { Handlers } from './Handlers.js';

/**
 * Wire format of the rpc endpoint: `"ndjson"` (default for HTTP; streams subscription chunks as
 * they are produced), `"json"` (one JSON array per response) or any `RpcSerialization` layer.
 * Clients must use the same serialization.
 */
export type Serialization = 'json' | 'ndjson' | Layer.Layer<RpcSerialization.RpcSerialization>;

/** Options shared by the HTTP adapters. */
export interface ServerOptions {
  /** Route of the rpc endpoint. Defaults to `"/rpc"`. */
  readonly path?: HttpRouter.PathInput | undefined;
  /** Wire format. Defaults to `"ndjson"` (`"json"` for websockets). */
  readonly serialization?: Serialization | undefined;
  /** Disables the server spans `RpcServer` creates for every request. */
  readonly disableTracing?: boolean | undefined;
  /** Prefix of the server span names. */
  readonly spanPrefix?: string | undefined;
  /** Maximum number of requests handled concurrently. Defaults to `"unbounded"`. */
  readonly concurrency?: number | 'unbounded' | undefined;
}

/** Options of {@link layerHttp}. */
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

/** Options of {@link toWebHandler}. */
export interface WebHandlerOptions<R extends Router.Any, LE> extends ServerOptions {
  /**
   * Layer providing every handler of the router and the server implementation of every
   * middleware it uses (`Layer.mergeAll(HandlersLive, AuthLive)`), with no remaining
   * requirements.
   */
  readonly handlers: Layer.Layer<Handlers.Requirements<R>, LE>;
}

/** A fetch-style request handler (`Request` → `Response`). */
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

/** Resolves a {@link Serialization} option to an `RpcSerialization` layer. */
export const serializationLayer = (
  serialization: Serialization | undefined,
  fallback: 'json' | 'ndjson' = 'ndjson',
): Layer.Layer<RpcSerialization.RpcSerialization> => {
  const value = serialization ?? fallback;
  if (value === 'ndjson') return RpcSerialization.layerNdjson;
  if (value === 'json') return RpcSerialization.layerJson;
  return value;
};

/**
 * Serves a router on an Effect `HttpRouter` route, for composing into an existing Effect HTTP
 * application (`HttpRouter.serve`, `HttpRouter.toWebHandler`, ...).
 *
 * A thin wrapper over `RpcServer.layerHttp` that defaults to `protocol: "http"` and always sets
 * `disableFatalDefects: true`, so a defect in one handler fails only that call instead of the
 * whole connection. The serialization layer is provided (default `"ndjson"`), and so is
 * `handlers` when given.
 *
 * ```ts
 * const RpcRoute = layerHttp(appRouter, { handlers: Layer.mergeAll(HandlersLive, AuthLive) });
 * HttpRouter.serve(RpcRoute).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })));
 * ```
 */
export const layerHttp = <R extends Router.Any, LOut = never, LE = never, LR = never>(
  router: R,
  options: LayerHttpOptions<LOut, LE, LR> = {},
): Layer.Layer<never, LE, HttpRouter.HttpRouter | LR | Exclude<Handlers.Requirements<R>, LOut>> => {
  const protocol = options.protocol ?? 'http';
  const server = RpcServer.layerHttp({
    group: router.group as RpcGroup.RpcGroup<Rpc.Any>,
    path: options.path ?? defaultPath,
    protocol,
    disableFatalDefects: true,
    disableTracing: options.disableTracing,
    spanPrefix: options.spanPrefix,
    concurrency: options.concurrency,
  }).pipe(
    Layer.provide(
      serializationLayer(options.serialization, protocol === 'http' ? 'ndjson' : 'json'),
    ),
  );
  const layer: Layer.Layer<never, unknown, unknown> =
    options.handlers === undefined ? server : server.pipe(Layer.provide(options.handlers));
  return layer as Layer.Layer<
    never,
    LE,
    HttpRouter.HttpRouter | LR | Exclude<Handlers.Requirements<R>, LOut>
  >;
};

/** Alias of {@link layerHttp}. */
export const toHttpLayer = layerHttp;

/**
 * Builds a fetch handler (`(request: Request) => Promise<Response>`) serving a router over HTTP,
 * for any fetch runtime: Next.js route handlers, TanStack Start server routes, Bun, Deno,
 * Cloudflare Workers, Hono, ...
 *
 * The handler layer is built eagerly, so the returned promise rejects when it fails to build.
 * The endpoint always uses `protocol: "http"` and `disableFatalDefects: true`: typed failures
 * and defects are encoded into the response `Exit` and later requests keep working.
 *
 * ```ts
 * const { handler, dispose } = await toWebHandler(appRouter, { handlers: HandlersLive });
 * export const POST = handler;
 * ```
 */
export const toWebHandler = async <R extends Router.Any, LE = never>(
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
    path: options.path,
    serialization: options.serialization,
    disableTracing: options.disableTracing,
    spanPrefix: options.spanPrefix,
    concurrency: options.concurrency,
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
