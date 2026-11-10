import { Effect, Layer, Schedule } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http';
import { RpcClient, RpcSerialization } from 'effect/rpc';
import { createClient, Link } from '@rpc-effect/client';

import { appRouter } from '@/router';

// #region protocol
// An HTTP link with a customized HttpClient: retries transient failures (rate limiting,
// timeouts, network issues) and adds a header to every request.
const resilientHttpLink = (url: string) => {
  const httpClient = Layer.effect(HttpClient.HttpClient)(
    Effect.gen(function* () {
      const base = yield* HttpClient.HttpClient;
      return base.pipe(
        HttpClient.filterStatusOk,
        HttpClient.mapRequest(HttpClientRequest.setHeader('x-client', 'web/1.4.0')),
        HttpClient.retryTransient({ schedule: Schedule.exponential('200 millis'), times: 3 }),
      );
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));

  return Link.fromProtocol(
    RpcClient.layerProtocolHttp({ url }).pipe(
      Layer.provide([httpClient, RpcSerialization.layerNdjson]), // must match the server
    ),
  );
};

const client = createClient(appRouter, { link: resilientHttpLink('https://api.example.com/rpc') });
// #endregion protocol

// #region make
// Link.make: full control over the RpcClient. It runs in the client's scope, so resources
// acquired here are released by client.dispose().
const loggingLink = (inner: Link) =>
  Link.make((group) =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(Effect.log('rpc client opened'), () =>
        Effect.log('rpc client closed'),
      );
      return yield* inner.makeClient(group);
    }),
  );
// #endregion make

void [client, loggingLink];
