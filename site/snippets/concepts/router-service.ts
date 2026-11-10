// The router module: shared by the server and the client. It holds no live layers.
import { Context, Effect, Schema, Stream } from 'effect';
import { Procedure } from '@rpc-effect/core';

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
