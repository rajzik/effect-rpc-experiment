// Spike fixture: ordinary Effect schemas. Nothing here knows about inference.
import { Data, Schema } from 'effect';

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

// Not a schema: an internal failure that must stay a defect on the client.
export class DbError extends Data.TaggedError('DbError')<{ readonly query: string }> {}
