import { Context, Effect, Layer, Schema } from 'effect';
import { Procedure } from '@effect-trpc/core';
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
