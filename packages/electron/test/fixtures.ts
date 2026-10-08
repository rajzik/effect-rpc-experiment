import { Effect, Schedule, Schema, Stream } from 'effect';
import { mutation, query, Router, subscription } from '@effect-trpc/core';
import { Handlers } from '@effect-trpc/server';
import { MainRpcServer } from '../src/index.js';

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
  user: {
    byId: query({ payload: { id: Schema.String }, success: User, error: NotFound }),
    create: mutation({ payload: { name: Schema.String }, success: User }),
  },
  /** Emits `0 .. n-1`, then completes. */
  ticks: subscription({ payload: { n: Schema.Number }, success: Schema.Number }),
  /** Emits `0 .. failAt-1`, then fails with `NotFound`. */
  tickStream: subscription({
    payload: { failAt: Schema.Number },
    success: Schema.Number,
    error: NotFound,
  }),
  /** Emits forever (every 5ms); records when the server stream is closed. */
  forever: subscription({ success: Schema.Number }),
  /** Never completes; records start and interruption. */
  slow: query({ success: Schema.String }),
  /** Dies. */
  boom: query({ success: Schema.String }),
  /** The sender id the main process attached to the connection (`null` without one). */
  whoami: query({ success: Schema.NullOr(Schema.Number) }),
});

export type AppRouter = typeof appRouter;

/** Observes server-side lifecycle events of the `slow` and `forever` handlers. */
export interface Probe {
  readonly started: Promise<void>;
  readonly interrupted: Promise<void>;
  readonly streamStarted: Promise<void>;
  readonly streamClosed: Promise<void>;
  readonly state: { started: number; interrupted: number; streamClosed: number };
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

const deferred = (): Deferred => {
  let resolve = (): void => {};
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

export const makeHandlers = () => {
  const state = { started: 0, interrupted: 0, streamClosed: 0 };
  const started = deferred();
  const interrupted = deferred();
  const streamStarted = deferred();
  const streamClosed = deferred();
  const probe: Probe = {
    started: started.promise,
    interrupted: interrupted.promise,
    streamStarted: streamStarted.promise,
    streamClosed: streamClosed.promise,
    state,
  };
  const handlers = Handlers.make(appRouter, {
    user: {
      byId: ({ id }) =>
        id === 'ghost'
          ? Effect.fail(new NotFound({ id }))
          : Effect.succeed(new User({ id, name: 'Ada', createdAt })),
      create: ({ name }) => Effect.succeed(new User({ id: 'new', name, createdAt })),
    },
    ticks: ({ n }) => Stream.range(0, n - 1),
    tickStream: ({ failAt }) =>
      Stream.range(0, failAt - 1).pipe(Stream.concat(Stream.fail(new NotFound({ id: 'tick' })))),
    forever: () =>
      Stream.fromSchedule(Schedule.spaced('5 millis')).pipe(
        Stream.tap(() => Effect.sync(streamStarted.resolve)),
        Stream.ensuring(
          Effect.sync(() => {
            state.streamClosed++;
            streamClosed.resolve();
          }),
        ),
      ),
    slow: () =>
      Effect.sync(() => {
        state.started++;
        started.resolve();
      }).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            state.interrupted++;
            interrupted.resolve();
          }),
        ),
      ),
    boom: () => Effect.die(new Error('kaboom')),
    whoami: (_, { headers }) => Effect.succeed(MainRpcServer.senderId(headers) ?? null),
  });
  return { handlers, probe };
};
