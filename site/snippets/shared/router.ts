// The demo router most guides use. Samples import it as `@/router` (a path alias for this file):
// in your app it is the module shared by the server and the client.
import { Context, Schema } from 'effect';
import { RpcMiddleware } from 'effect/rpc';
import { mutation, query, Router, subscription } from '@rpc-effect/core';

// Domain data: a Schema.Class arrives on the client as a real `Post` instance.
export class Post extends Schema.Class<Post>('Post')({
  id: Schema.Finite,
  title: Schema.String,
  createdAt: Schema.Date,
}) {
  get slug(): string {
    return this.title.toLowerCase().replaceAll(' ', '-');
  }
}

export class PostPage extends Schema.Class<PostPage>('PostPage')({
  items: Schema.Array(Post),
  nextCursor: Schema.NullOr(Schema.Finite),
}) {}

// Typed errors: Schema.TaggedError classes, narrowed on `_tag`.
export class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.Finite,
}) {}
export class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {
  reason: Schema.String,
}) {}
export class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}

// The signed-in user, provided to handlers by the Auth middleware.
export class CurrentUser extends Context.Service<CurrentUser, { readonly name: string }>()(
  'CurrentUser',
) {}

// Declared next to the router (client-safe); implemented on the server (see `@/server`).
export class Auth extends RpcMiddleware.Service<Auth, { provides: CurrentUser }>()('Auth', {
  error: Unauthorized,
}) {}

export const appRouter = Router.make({
  health: query({ success: Schema.Literal('ok') }),
  post: {
    byId: query({ payload: { id: Schema.Finite }, success: Post, error: PostNotFound }),
    // A `cursor` in the input enables `infiniteQueryOptions`.
    list: query({
      payload: { cursor: Schema.optional(Schema.NullOr(Schema.Finite)) },
      success: PostPage,
    }),
    create: mutation({
      payload: { title: Schema.String },
      success: Post,
      error: Forbidden,
    }).middleware(Auth),
    onCreated: subscription({ success: Post }),
  },
});

export type AppRouter = typeof appRouter;
