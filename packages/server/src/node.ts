/**
 * Runs a router on Node's `http` module (`@effect-trpc/server/node`).
 *
 * `serve` returns a `Layer` for long-running Effect programs and `runServer` returns a `Promise`
 * of a started server for tests and scripts. Both mount `layerHttp` (HTTP protocol, NDJSON by
 * default) on a `NodeHttpServer` from `@effect/platform-node`, an optional peer dependency used
 * only by this subpath, so the main `@effect-trpc/server` entry stays platform-neutral.
 *
 * @since 0.1.0
 */
import { createServer } from 'node:http';
import { Effect, Layer, ManagedRuntime } from 'effect';
import type { Duration } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { NetAddress } from 'effect/net';
import type { HttpServerError } from 'effect/http';
import { NodeHttpServer } from '@effect/platform-node';
import type { Router } from '@effect-trpc/core';
import type { Handlers } from './Handlers.js';
import { layerHttp } from './Http.js';
import type { ServerOptions } from './Http.js';

/**
 * Options of {@link serve} and {@link runServer}.
 *
 * @category options
 * @since 0.1.0
 */
export interface NodeServeOptions<R extends Router.Any, LE, LR> extends ServerOptions {
  /**
   * Layer providing every handler of the router and the server implementation of every
   * middleware it uses.
   */
  readonly handlers: Layer.Layer<Handlers.Requirements<R>, LE, LR>;
  /** TCP port. `0` picks a free ephemeral port. */
  readonly port: number;
  /** Interface to listen on. Defaults to all interfaces. */
  readonly host?: string | undefined;
  /** Logs the listening address. Defaults to `false`. */
  readonly listenLog?: boolean | undefined;
  /**
   * How long shutdown waits for in-flight requests before interrupting them. Defaults to the
   * platform default (20 seconds) for `serve` and to 1 second for `runServer`.
   */
  readonly gracefulShutdownTimeout?: Duration.Input | undefined;
}

/**
 * A running server started by {@link runServer}.
 *
 * **Details**
 *
 * - `dispose()` stops listening, interrupts in-flight requests after `gracefulShutdownTimeout`
 *   and releases the handler layer. It is also available as `await using`.
 *
 * @category models
 * @since 0.1.0
 */
export interface RunningServer {
  /** Absolute URL of the rpc endpoint, e.g. `http://localhost:3000/rpc`. */
  readonly url: string;
  /** The port the server listens on (useful with `port: 0`). */
  readonly port: number;
  /** Stops the server and releases the handler layer. */
  readonly dispose: () => Promise<void>;
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}

const nodeServerLayer = (options: {
  readonly port: number;
  readonly host?: string | undefined;
  readonly gracefulShutdownTimeout?: Duration.Input | undefined;
}) =>
  NodeHttpServer.layer(() => createServer(), {
    port: options.port,
    ...(options.host === undefined ? {} : { host: options.host }),
    gracefulShutdownTimeout: options.gracefulShutdownTimeout,
  });

const appLayer = <R extends Router.Any, LE, LR>(
  router: R,
  options: NodeServeOptions<R, LE, LR>,
): Layer.Layer<never, LE, HttpRouter.HttpRouter | LR> =>
  layerHttp(router, {
    handlers: options.handlers,
    path: options.path,
    serialization: options.serialization,
    disableTracing: options.disableTracing,
    spanPrefix: options.spanPrefix,
    concurrency: options.concurrency,
    protocol: 'http',
  });

/**
 * Serves a router over HTTP with Node's `http` module. Returns a layer: launch it with
 * `Layer.launch(serve(...)).pipe(NodeRuntime.runMain)` or compose it into a larger app.
 *
 * **When to use**
 *
 * Use for a long-running Node process whose only job is serving the router. Prefer
 * {@link runServer} in tests and scripts that need the URL as a Promise, and `layerHttp` from
 * `@effect-trpc/server` when the endpoint shares a server with other routes.
 *
 * **Details**
 *
 * - Always `protocol: "http"` with `disableFatalDefects: true`, at `path` (default `"/rpc"`).
 * - The listen log is off unless `listenLog: true`; the request logger is always off.
 * - `handlers` may have requirements (`LR`); they stay requirements of the returned layer.
 *
 * **Example** (A standalone Node server)
 *
 * ```ts
 * import { Effect, Layer, Schema } from 'effect';
 * import { NodeRuntime } from '@effect/platform-node';
 * import { query, Router } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 * import { serve } from '@effect-trpc/server/node';
 *
 * const appRouter = Router.make({ health: query({ success: Schema.Literal('ok') }) });
 * const HandlersLive = Handlers.make(appRouter, { health: () => Effect.succeed('ok' as const) });
 *
 * Layer.launch(serve(appRouter, { handlers: HandlersLive, port: 3000, listenLog: true })).pipe(
 *   NodeRuntime.runMain,
 * );
 * ```
 *
 * @see {@link runServer}
 * @category adapters
 * @since 0.1.0
 */
export const serve = <R extends Router.Any, LE = never, LR = never>(
  router: R,
  options: NodeServeOptions<R, LE, LR>,
): Layer.Layer<never, LE | HttpServerError.ServeError, LR> =>
  HttpRouter.serve(appLayer(router, options), {
    disableLogger: true,
    disableListenLog: options.listenLog !== true,
  }).pipe(Layer.provide(nodeServerLayer(options))) as Layer.Layer<
    never,
    LE | HttpServerError.ServeError,
    LR
  >;

/**
 * Starts a Node HTTP server for a router and resolves once it listens. With `port: 0` an
 * ephemeral port is picked; read it from `url` / `port`.
 *
 * **When to use**
 *
 * Use in tests, scripts and dev tooling that need a real HTTP endpoint for `httpLink`. Prefer
 * {@link serve} for a long-running process managed by Effect.
 *
 * **Details**
 *
 * - `url` is absolute (`http://localhost:<port><path>`; `localhost` replaces an unspecified
 *   bind address), so it can be passed straight to `httpLink({ url })`.
 * - `gracefulShutdownTimeout` defaults to 1 second here, so `dispose()` does not wait 20 seconds
 *   for a hanging request.
 * - The promise rejects (after releasing everything) when the handler layer fails to build or
 *   the port cannot be bound.
 *
 * **Gotchas**
 *
 * - `handlers` must have no remaining requirements; provide its services first.
 * - Always `await server.dispose()` (or `await using`), otherwise the process keeps listening.
 *
 * **Example** (Starting a server on a free port for a test)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 * import { runServer } from '@effect-trpc/server/node';
 *
 * const appRouter = Router.make({ health: query({ success: Schema.Literal('ok') }) });
 * const HandlersLive = Handlers.make(appRouter, { health: () => Effect.succeed('ok' as const) });
 *
 * await using server = await runServer(appRouter, { handlers: HandlersLive, port: 0 });
 * server.url; // "http://localhost:54321/rpc"
 * ```
 *
 * @see {@link serve}
 * @category adapters
 * @since 0.1.0
 */
export const runServer = async <R extends Router.Any, LE = never>(
  router: R,
  options: NodeServeOptions<R, LE, never>,
): Promise<RunningServer> => {
  const layer = HttpRouter.serve(appLayer(router, options), {
    disableLogger: true,
    disableListenLog: options.listenLog !== true,
  }).pipe(
    Layer.provideMerge(
      nodeServerLayer({
        ...options,
        gracefulShutdownTimeout: options.gracefulShutdownTimeout ?? '1 second',
      }),
    ),
  );
  const runtime = ManagedRuntime.make(layer);
  try {
    const address = await runtime.runPromise(
      Effect.map(HttpServer.HttpServer, (server) => server.address),
    );
    if (address._tag === 'UnixPathAddress') {
      throw new Error(`runServer needs a TCP address, got ${address.path}`);
    }
    const origin = NetAddress.isUnspecified(address.address)
      ? `http://localhost:${address.port}`
      : HttpServer.formatAddress(address);
    const dispose = (): Promise<void> => runtime.dispose();
    return {
      url: `${origin}${options.path ?? '/rpc'}`,
      port: address.port,
      dispose,
      [Symbol.asyncDispose]: dispose,
    };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
};
