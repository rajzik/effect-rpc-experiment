import { Context, Effect, Layer, Schedule, Stream } from 'effect';
import { createClient, httpLink, type Client } from '@effect-trpc/client';
import { RpcTransportError } from '@effect-trpc/core';

import { appRouter, type AppRouter } from '@/router';

const client = createClient(appRouter, { link: httpLink({ url: 'https://api.example.com/rpc' }) });

// #region basics
// `$effect` mirrors the router. Calls are Effects with no requirements.
const title = client.$effect.post.byId({ id: 1 }).pipe(
  Effect.map((post) => post.title),
  Effect.catchTag('PostNotFound', (e) => Effect.succeed(`missing #${e.id}`)),
  // Only transport errors are worth retrying.
  Effect.retry({
    schedule: Schedule.exponential('100 millis'),
    times: 3,
    while: (e) => e instanceof RpcTransportError,
  }),
); // Effect<string, RpcTransportError>

const created = Stream.runCollect(client.$effect.post.onCreated().pipe(Stream.take(5)));
// #endregion basics

// #region service
// Provide the client as a service, so programs depend on an interface, not a URL.
class Api extends Context.Service<Api, Client.Effect<AppRouter>>()('Api') {}

const ApiLive = Layer.effect(Api)(
  Effect.acquireRelease(
    Effect.sync(() =>
      createClient(appRouter, { link: httpLink({ url: 'https://api.example.com/rpc' }) }),
    ),
    (c) => Effect.promise(() => c.dispose()),
  ).pipe(Effect.map((c) => c.$effect)),
);

const program = Effect.gen(function* () {
  const api = yield* Api;
  const post = yield* api.post.byId({ id: 1 });
  return post.slug;
});

await Effect.runPromise(program.pipe(Effect.provide(ApiLive)));
// #endregion service

void [title, created];
