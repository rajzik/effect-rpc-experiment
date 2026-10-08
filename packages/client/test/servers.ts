import { NodeHttpServer } from '@effect/platform-node';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { RpcSerialization, RpcServer } from 'effect/rpc';
import type { Rpc, RpcGroup } from 'effect/rpc';
import { appRouter, makeHandlers } from './fixtures.js';

export interface TestServer {
  /** `http://127.0.0.1:<port>/rpc` */
  readonly url: string;
  /** `ws://127.0.0.1:<port>/rpc` */
  readonly wsUrl: string;
  readonly dispose: () => Promise<void>;
}

/** Serves an rpc group on an ephemeral port with a real Node HTTP server, at `/rpc`. */
export const serveGroup = async <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  handlers: Layer.Layer<Rpc.ToHandler<Rpcs> | Rpc.Middleware<Rpcs> | Rpc.ServicesServer<Rpcs>>,
  options: {
    readonly protocol: 'http' | 'websocket';
    readonly serialization?: 'json' | 'ndjson' | undefined;
  },
): Promise<TestServer> => {
  const ServerLive = HttpRouter.serve(
    RpcServer.layerHttp({
      group,
      path: '/rpc',
      protocol: options.protocol,
      disableFatalDefects: true,
    }),
    { disableLogger: true, disableListenLog: true },
  ).pipe(
    Layer.provide(handlers),
    Layer.provide(
      options.serialization === 'json' ? RpcSerialization.layerJson : RpcSerialization.layerNdjson,
    ),
    Layer.provideMerge(NodeHttpServer.layerTest),
  );
  // The generic `Rpcs` leaves unresolved `Exclude<...>` requirements; they are all provided above.
  const runtime = ManagedRuntime.make(
    ServerLive as unknown as Layer.Layer<HttpServer.HttpServer, unknown>,
  );
  const base = await runtime.runPromise(
    Effect.gen(function* () {
      const server = yield* HttpServer.HttpServer;
      return HttpServer.formatAddress(server.address);
    }),
  );
  return {
    url: `${base}/rpc`,
    wsUrl: `${base.replace(/^http/, 'ws')}/rpc`,
    dispose: () => runtime.dispose(),
  };
};

/** Starts `appRouter` (see `fixtures.ts`) on an ephemeral port. */
export const startServer = (options: {
  readonly protocol: 'http' | 'websocket';
  readonly serialization?: 'json' | 'ndjson';
  readonly handlers?: ReturnType<typeof makeHandlers>;
}): Promise<TestServer> => serveGroup(appRouter.group, options.handlers ?? makeHandlers(), options);
