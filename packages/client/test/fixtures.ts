import { mutation, query, Router, subscription } from '@effect-trpc/core';
import { Context, Effect, Layer, Schedule, Schema, Stream } from 'effect';
import { RpcMiddleware } from 'effect/rpc';

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

export class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {
  reason: Schema.String,
}) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}

export class CurrentUser extends Context.Service<CurrentUser, { readonly name: string }>()(
  'CurrentUser',
) {}

/** Server middleware: reads the `x-user` header and provides `CurrentUser`. */
export class Auth extends RpcMiddleware.Service<Auth, { provides: CurrentUser }>()('Auth', {
  error: Unauthorized,
}) {}

export const AuthLive = Layer.succeed(Auth)((effect, { headers }) => {
  const name = headers['x-user'];
  return name === undefined
    ? Effect.fail(new Unauthorized())
    : Effect.provideService(effect, CurrentUser, { name });
});

export const appRouter = Router.make({
  health: query({ success: Schema.Literal('ok') }),
  user: {
    byId: query({
      payload: { id: Schema.String },
      success: User,
      error: Schema.Union([NotFound, Forbidden]),
    }),
    create: mutation({ payload: { name: Schema.String }, success: User }),
    /** Mutation without input (tRPC issue 2540: calling with `undefined`). */
    reset: mutation({ success: Schema.Number }),
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
  /** Returns the rpc headers the handler received (only `x-*` headers). */
  headers: query({ success: Schema.Record(Schema.String, Schema.String) }),
  whoami: query({ success: Schema.String }).middleware(Auth),
});

export type AppRouter = typeof appRouter;

export const alice = (): User =>
  new User({ id: '1', name: 'Alice', createdAt: new Date('2026-01-02T03:04:05.000Z') });

/** Observes server-side lifecycle events of the `slow` and `forever` handlers. */
export interface Probe {
  readonly started: Promise<void>;
  readonly interrupted: Promise<void>;
  readonly streamClosed: Promise<void>;
  readonly state: { started: number; interrupted: number; streamClosed: number };
}

interface ProbeHooks {
  readonly start: () => void;
  readonly interrupt: () => void;
  readonly closeStream: () => void;
}

export const makeProbe = (): Probe & ProbeHooks => {
  const state = { started: 0, interrupted: 0, streamClosed: 0 };
  let start = (): void => {};
  let interrupt = (): void => {};
  let closeStream = (): void => {};
  const started = new Promise<void>((resolve) => (start = resolve));
  const interrupted = new Promise<void>((resolve) => (interrupt = resolve));
  const streamClosed = new Promise<void>((resolve) => (closeStream = resolve));
  return {
    started,
    interrupted,
    streamClosed,
    state,
    start: () => {
      state.started++;
      start();
    },
    interrupt: () => {
      state.interrupted++;
      interrupt();
    },
    closeStream: () => {
      state.streamClosed++;
      closeStream();
    },
  };
};

const pickXHeaders = (headers: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).filter(([key]) => key.startsWith('x-')));

/** The handlers of `appRouter` plus the `Auth` middleware implementation. */
export const makeHandlers = (probe: ProbeHooks = makeProbe()) =>
  Layer.mergeAll(
    appRouter.group.toLayer({
      health: () => Effect.succeed('ok' as const),
      'user.byId': ({ id }) =>
        id === '1'
          ? Effect.succeed(alice())
          : id === 'secret'
            ? Effect.fail(new Forbidden({ reason: 'private' }))
            : Effect.fail(new NotFound({ id })),
      'user.create': ({ name }) =>
        Effect.succeed(new User({ id: '2', name, createdAt: new Date(0) })),
      'user.reset': () => Effect.succeed(0),
      ticks: ({ n }) => Stream.range(0, n - 1),
      tickStream: ({ failAt }) =>
        Stream.range(0, failAt - 1).pipe(Stream.concat(Stream.fail(new NotFound({ id: 'tick' })))),
      forever: () =>
        Stream.fromSchedule(Schedule.spaced('5 millis')).pipe(
          Stream.ensuring(Effect.sync(probe.closeStream)),
        ),
      slow: () =>
        Effect.sync(probe.start).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Effect.sync(probe.interrupt)),
        ),
      boom: () => Effect.die(new Error('kaboom')),
      headers: (_, { headers }) => Effect.succeed(pickXHeaders(headers)),
      whoami: () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          return user.name;
        }),
    }),
    AuthLive,
  );
