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

/** Options of {@link serve} and {@link runServer}. */
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

/** A running server started by {@link runServer}. */
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
 * ```ts
 * Layer.launch(serve(appRouter, { handlers: HandlersLive, port: 3000 })).pipe(NodeRuntime.runMain);
 * ```
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
 * ```ts
 * const server = await runServer(appRouter, { handlers: HandlersLive, port: 0 });
 * server.url; // "http://localhost:54321/rpc"
 * await server.dispose();
 * ```
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
