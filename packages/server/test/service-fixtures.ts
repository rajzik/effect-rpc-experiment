// A router written once as an Effect service (`Procedure` builder + `Context.Service`), shared by
// `routerService.test.ts` and `routerService.test-d.ts`.
import { Context, Effect, Layer, Schema, Stream } from 'effect';
import { Procedure, query } from '@effect-trpc/core';
import { Auth, CurrentUser } from './fixtures.js';

export class Post extends Schema.Class<Post>('Post')({
  id: Schema.Finite,
  title: Schema.String,
  createdAt: Schema.Date,
}) {
  headline(): string {
    return `#${this.id} ${this.title}`;
  }
}

export class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.Finite,
}) {}

export class Database extends Context.Service<
  Database,
  {
    readonly findPost: (id: number) => Effect.Effect<Post, PostNotFound>;
    readonly titles: Stream.Stream<string>;
  }
>()('Database') {}

export const postCreatedAt = new Date('2026-01-02T03:04:05.000Z');

export const DatabaseLive = Layer.succeed(Database)({
  findPost: (id) =>
    id === 1
      ? Effect.succeed(new Post({ id, title: 'Hello', createdAt: postCreatedAt }))
      : Effect.fail(new PostNotFound({ id })),
  titles: Stream.make('first', 'second'),
});

/** Counts evaluations of `AppRouter.make` (memoized by the sync APIs; `Handlers.fromService` reuses it). */
export const makeRuns = { count: 0 };

export class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.sync(() => {
    makeRuns.count++;
    return {
      health: Procedure.output(Schema.Literal('ok')).query(() => Effect.succeed('ok' as const)),
      post: {
        byId: Procedure.input({ id: Schema.Finite })
          .output(Post)
          .error(PostNotFound)
          .query(
            Effect.fn(function* ({ id }) {
              const db = yield* Database;
              return yield* db.findPost(id);
            }),
          ),
        titles: Procedure.output(Schema.String).subscription(() =>
          Stream.unwrap(Effect.map(Database, (db) => db.titles)),
        ),
      },
      // `CurrentUser` is provided by `Auth`: not a requirement of the handler layer.
      me: Procedure.output(Schema.String)
        .middleware(Auth)
        .query(
          Effect.fn(function* () {
            const user = yield* CurrentUser;
            return user.name;
          }),
        ),
      // Middleware added after the terminal provides `CurrentUser` too.
      whoami: Procedure.output(Schema.String)
        .query(() => Effect.map(CurrentUser, (user) => `I am ${user.name}`))
        .middleware(Auth),
    };
  }),
}) {}

/** A router service mixing builder procedures and legacy `query({...})` definitions. */
export class LegacyRouter extends Context.Service<LegacyRouter>()('LegacyRouter', {
  make: Effect.succeed({
    ok: Procedure.query(() => Effect.void),
    user: { byId: query({ success: Schema.String }) },
    health: query({ success: Schema.Literal('ok') }),
  }),
}) {}
