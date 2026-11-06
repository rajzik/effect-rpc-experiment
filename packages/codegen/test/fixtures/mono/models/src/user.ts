import { Effect, Schema } from 'effect';
import { UserNotFound } from './errors.js';

export class User extends Schema.Class<User>('User')({ id: Schema.Finite, name: Schema.String }) {}

export const findUser = (id: number): Effect.Effect<User, UserNotFound> =>
  id === 1 ? Effect.succeed(new User({ id, name: 'Ada' })) : Effect.fail(new UserNotFound({ id }));
