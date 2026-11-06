import { Context, Effect, Layer, Schema, Stream } from 'effect';
import { createClient, httpLink } from '@effect-trpc/client';
import { Procedure } from '@effect-trpc/core';
import { Handlers, toWebHandler } from '@effect-trpc/server';

import { Post, PostNotFound } from '@/router';

// #region service
// An ordinary service. Handlers read it; its live layer stays on the server.
export class Database extends Context.Service<
  Database,
  {
    readonly findPost: (id: number) => Effect.Effect<Post, PostNotFound>;
    readonly titles: Stream.Stream<string>;
  }
>()('Database') {}

// The router: a plain Effect service whose `make` is an Effect *value* returning procedures.
export class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.succeed({
    health: Procedure.output(Schema.Literal('ok')).query(() => Effect.succeed('ok' as const)),
    post: {
      byId: Procedure.input({ id: Schema.Finite })
        .output(Post)
        .error(PostNotFound)
        .query(
          Effect.fn(function* ({ id }) {
            // id: number, inferred from .input
            const db = yield* Database; // services are read inside the handler
            return yield* db.findPost(id); // checked against .output and .error
          }),
        ),
      titles: Procedure.output(Schema.String).subscription(() =>
        Stream.unwrap(Effect.map(Database, (db) => db.titles)),
      ),
    },
  }),
}) {}
// #endregion service

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

// #region client
const client = createClient(AppRouter, {
  link: httpLink({ url: 'http://localhost:3000/rpc' }),
});

const post = await client.post.byId({ id: 1 });
post instanceof Post; // true: the client evaluates `make` to get the schemas
post.slug; // "hello-effect"

try {
  await client.post.byId({ id: 404 });
} catch (cause) {
  if (cause instanceof PostNotFound) console.log(`no post #${cause.id}`);
}
// #endregion client
