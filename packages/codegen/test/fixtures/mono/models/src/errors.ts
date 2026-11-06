// Exported through the `./errors` subpath only (not the barrel).
import { Schema } from 'effect';

export class UserNotFound extends Schema.TaggedError<UserNotFound>()('UserNotFound', {
  id: Schema.Finite,
}) {}
