import { Context, Effect, Layer, Schema } from 'effect';
import { Procedure, Router } from '@effect-trpc/core';
import { Handlers } from '@effect-trpc/server';

import { Auth, CurrentUser, Forbidden, Post, Unauthorized } from '@/router';

// #region middleware
export class PostsRouter extends Context.Service<PostsRouter>()('PostsRouter', {
  make: Effect.succeed({
    create: Procedure.input({ title: Schema.String })
      .output(Post)
      .error(Forbidden)
      .middleware(Auth) // adds Unauthorized to the errors, provides CurrentUser
      .mutation(
        Effect.fn(function* ({ title }) {
          const user = yield* CurrentUser; // provided by Auth: not a requirement of the layer
          if (user.name === 'guest') return yield* new Forbidden({ reason: 'guests cannot post' });
          return new Post({ id: 1, title, createdAt: new Date() });
        }),
      ),
  }),
}) {}

// The implementation of `Auth` is a separate layer, merged in as with `Handlers.make`.
const AuthLive = Layer.succeed(Auth)(
  Auth.of((effect, { headers }) => {
    const name = headers['authorization']?.replace(/^Bearer /, '');
    return name === undefined
      ? Effect.fail(new Unauthorized())
      : Effect.provideService(effect, CurrentUser, { name });
  }),
);

export const PostsLive = Layer.mergeAll(Handlers.fromService(PostsRouter), AuthLive);
// #endregion middleware

// #region group
// Middleware for a group of procedures: nest a router with `.middleware(M)` in the `make` record.
// (`make` itself must return a record: `Effect.succeed(Router.make({...}).middleware(Auth))` is a
// compile error.)
export class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.succeed({
    health: Procedure.output(Schema.Literal('ok')).query(() => Effect.succeed('ok' as const)),
    admin: Router.make({
      whoami: Procedure.output(Schema.String).query(() =>
        Effect.map(CurrentUser, (user) => user.name),
      ),
    }).middleware(Auth), // every procedure under admin.* runs Auth
  }),
}) {}

export const AppLive = Layer.mergeAll(Handlers.fromService(AppRouter), AuthLive);
// #endregion group
