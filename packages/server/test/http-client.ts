// An effect/rpc client over real HTTP (NDJSON by default), used to prove what crosses the wire.
import { Effect, Layer } from 'effect';
import type { Exit } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { RpcClient, RpcSerialization } from 'effect/rpc';
import { appRouter } from './fixtures.js';

export type AppClient = RpcClient.FromGroup<typeof appRouter.group, unknown>;

export const withHttpClient = <A, E>(
  url: string,
  f: (client: AppClient) => Effect.Effect<A, E>,
  serialization: Layer.Layer<RpcSerialization.RpcSerialization> = RpcSerialization.layerNdjson,
): Promise<Exit.Exit<A, unknown>> =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(appRouter.group);
      return yield* f(client);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        RpcClient.layerProtocolHttp({ url }).pipe(
          Layer.provide([FetchHttpClient.layer, serialization]),
        ),
      ),
    ),
  );
