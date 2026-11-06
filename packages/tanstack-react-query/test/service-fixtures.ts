// A router written once as an Effect service (`Procedure` builder + `Context.Service`), plus the
// equivalent `Router.make` router of plain definitions, shared by `routerService.test(-d).ts`.
import { Context, Effect, Schema, Stream } from 'effect';
import { query, Procedure, Router, subscription } from '@effect-trpc/core';
import { Handlers } from '@effect-trpc/server';

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

export const postCreatedAt = new Date('2026-01-02T03:04:05.000Z');

export class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.succeed({
    health: Procedure.output(Schema.Literal('ok')).query(() => Effect.succeed('ok' as const)),
    post: {
      byId: Procedure.input({ id: Schema.Finite })
        .output(Post)
        .error(PostNotFound)
        .query(({ id }) =>
          id === 1
            ? Effect.succeed(new Post({ id, title: 'Hello', createdAt: postCreatedAt }))
            : Effect.fail(new PostNotFound({ id })),
        ),
      titles: Procedure.output(Schema.String).subscription(() => Stream.make('first', 'second')),
    },
  }),
}) {}

/** The same procedures as plain definitions: what `typeof AppRouter` must infer like. */
export const plainRouter = Router.make({
  health: query({ success: Schema.Literal('ok') }),
  post: {
    byId: query({ payload: { id: Schema.Finite }, success: Post, error: PostNotFound }),
    titles: subscription({ success: Schema.String }),
  },
});

/** The handler layer built from the procedures' own handlers. */
export const AppHandlers = Handlers.fromService(AppRouter);
