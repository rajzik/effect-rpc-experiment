// The server module: the only one that imports the live layers.
import { Effect, Layer, Stream } from 'effect';
import { Handlers, toWebHandler } from '@rpc-effect/server';

import { Post, PostNotFound } from '@/router';
import { AppRouter, Database } from './router-service';

// #region handlers
export const DatabaseLive = Layer.succeed(Database)({
  findPost: (id) =>
    id === 1
      ? Effect.succeed(new Post({ id, title: 'Hello Effect', createdAt: new Date('2026-01-01') }))
      : Effect.fail(new PostNotFound({ id })),
  titles: Stream.make('Hello Effect', 'Typed errors'),
});

// Layer<Rpc.Handler<…> | AppRouter, never, Database>: `Database` is inferred from the handlers.
export const HandlersLive = Handlers.fromService(AppRouter);

export const ServerLive = HandlersLive.pipe(Layer.provide(DatabaseLive));
// #endregion handlers

// #region serve
// Every adapter takes the class where it takes a router.
export const web = await toWebHandler(AppRouter, { handlers: ServerLive });
// web.handler: (request: Request) => Promise<Response>
// #endregion serve
