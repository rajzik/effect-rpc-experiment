import { Effect, Schema, Stream } from 'effect';
import { mutation, query, Router, subscription } from '@effect-trpc/core';
import { Handlers } from '@effect-trpc/server';

export class User extends Schema.Class<User>('User')({
  id: Schema.String,
  name: Schema.String,
  createdAt: Schema.Date,
}) {
  greet(): string {
    return `Hello, ${this.name}!`;
  }
}

export class NotFound extends Schema.TaggedError<NotFound>()('NotFound', {
  id: Schema.String,
}) {}

export const createdAt = new Date('2026-01-02T03:04:05.000Z');

export const appRouter = Router.make({
  health: query({ success: Schema.Literal('ok') }),
  user: {
    byId: query({ payload: { id: Schema.String }, success: User, error: NotFound }),
    create: mutation({ payload: { name: Schema.String }, success: User }),
    /** Emits `count` users, then completes. */
    list: subscription({ payload: { count: Schema.Number }, success: User }),
  },
  /** Always dies. */
  boom: query({ success: Schema.String }),
});

export type AppRouter = typeof appRouter;

const makeUser = (id: string, name: string): User => new User({ id, name, createdAt });

export const HandlersLive = Handlers.make(appRouter, {
  health: () => Effect.succeed('ok' as const),
  user: {
    byId: ({ id }) =>
      id === 'ghost' ? Effect.fail(new NotFound({ id })) : Effect.succeed(makeUser(id, 'Ada')),
    create: ({ name }) => Effect.succeed(makeUser('new', name)),
    list: ({ count }) =>
      Stream.fromIterable(Array.from({ length: count }, (_, i) => makeUser(`u${i + 1}`, 'Ada'))),
  },
  boom: () => Effect.die(new Error('kaboom')),
});
