// Client-safe declarations: schemas, errors and a middleware tag.
import { Schema } from 'effect';
import { RpcMiddleware } from 'effect/rpc';

export class Post extends Schema.Class<Post>('Post')({
  id: Schema.Finite,
  title: Schema.String,
}) {}

export class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.Finite,
}) {}

// Not used by the router module: the drift test adds it to a procedure there.
export class Auth extends RpcMiddleware.Service<Auth>()('Auth') {}
