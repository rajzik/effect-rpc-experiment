// Client-safe declarations: schemas, errors and middleware tags.
import { Data, Schema } from 'effect';
import { RpcMiddleware } from 'effect/rpc';

export class Post extends Schema.Class<Post>('Post')({
  id: Schema.Finite,
  title: Schema.String,
  createdAt: Schema.Date,
}) {
  get slug(): string {
    return this.title.toLowerCase().replaceAll(' ', '-');
  }
}

export class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.Finite,
}) {}
export class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {
  reason: Schema.String,
}) {}
export class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}

// Not a schema: stays a defect on the client.
export class DbError extends Data.TaggedError('DbError')<{ readonly query: string }> {}

export class Auth extends RpcMiddleware.Service<Auth>()('Auth', { error: Unauthorized }) {}
export class Log extends RpcMiddleware.Service<Log>()('Log') {}

/** A recursive type: generated as a hoisted `Schema.suspend` declaration. */
export interface Tree {
  readonly value: number;
  readonly children: ReadonlyArray<Tree>;
}
