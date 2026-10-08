import { Cause, Exit, Schema } from 'effect';
import { RpcMiddleware } from 'effect/rpc';
import { mutation, query, Router, subscription } from '../src/index.js';

export class Post extends Schema.Class<Post>('Post')({
  id: Schema.Number,
  title: Schema.String,
  createdAt: Schema.Date,
}) {
  get slug(): string {
    return this.title.toLowerCase().replaceAll(' ', '-');
  }
  describe(): string {
    return `#${this.id} ${this.title}`;
  }
}

export class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.Number,
}) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {
  reason: Schema.String,
}) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}

export class AuthMiddleware extends RpcMiddleware.Service<AuthMiddleware>()('AuthMiddleware', {
  error: Unauthorized,
}) {}

export class LogMiddleware extends RpcMiddleware.Service<LogMiddleware>()('LogMiddleware') {}

export const byId = query({
  payload: { id: Schema.Number },
  success: Post,
  error: Schema.Union([PostNotFound, Forbidden]),
});

export const create = mutation({
  payload: { title: Schema.String },
  success: Post,
  error: Forbidden,
});

export const onPost = subscription({
  payload: { since: Schema.Number },
  success: Post,
  error: Forbidden,
});

export const health = query({ success: Schema.Literal('ok') });

export const adminRouter = Router.make({
  stats: { count: query({ success: Schema.Number }) },
});

export const appRouter = Router.make({
  health,
  post: { byId, create, onPost },
  admin: adminRouter,
  deep: { a: { b: query({ success: Schema.String }) } },
});

export const samplePost = (): Post =>
  new Post({ id: 1, title: 'Hello World', createdAt: new Date('2026-01-02T03:04:05.000Z') });

/** Returns the success value or throws (keeps assertions unconditional). */
export const getSuccess = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isFailure(exit)) throw new Error(`Expected a success, got ${Cause.pretty(exit.cause)}`);
  return exit.value;
};

/** Returns the failure cause or throws (keeps assertions unconditional). */
export const getCause = <A, E>(exit: Exit.Exit<A, E>): Cause.Cause<E> => {
  if (Exit.isSuccess(exit)) throw new Error('Expected a failure, got a success');
  return exit.cause;
};
