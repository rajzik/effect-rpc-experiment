import { Cause, Context, Effect, Exit, Layer, Schema, Stream } from 'effect';
import { mutation, query, Router, subscription } from '@effect-trpc/core';
import { Handlers, Middleware } from '../src/index.js';

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

/** Provided by the `Auth` middleware from the `x-user` header. */
export class CurrentUser extends Context.Service<CurrentUser, { readonly name: string }>()(
  'CurrentUser',
) {}

export class Auth extends Middleware.make<Auth, { provides: CurrentUser }>()('Auth', {
  error: Unauthorized,
}) {}

/** Records the order middleware runs in (`middlewares.test.ts` chaining). */
export class Trace extends Middleware.make<Trace>()('Trace') {}

export const createdAt = new Date('2026-01-02T03:04:05.000Z');

export const ada = (): User => new User({ id: 'ada', name: 'Ada', createdAt });

export const appRouter = Router.make({
  health: query({ success: Schema.Literal('ok') }),
  user: {
    byId: query({
      payload: { id: Schema.String },
      success: User,
      error: Schema.Union([NotFound, Forbidden]),
    }),
    create: mutation({ payload: { name: Schema.String }, success: User }),
    list: subscription({ payload: { count: Schema.Number }, success: User }),
    me: query({ success: User }).middleware(Trace).middleware(Auth),
  },
  debug: {
    die: query({ success: Schema.String }),
    hang: query({ success: Schema.String }),
    headers: query({ success: Schema.Struct({ trace: Schema.NullOr(Schema.String) }) }),
    requestId: query({ success: Schema.String }),
    badOutput: query({ success: Schema.Int }),
    ping: mutation({ success: Schema.Literal('pong') }),
    nullable: subscription({ success: Schema.NullOr(Schema.Number) }),
    failMidStream: subscription({ success: Schema.Number, error: NotFound }),
    infinite: subscription({ success: Schema.Number }),
  },
});

export type AppRouter = typeof appRouter;

/** Observable side effects of the handlers, one instance per test. */
export interface Probe {
  readonly events: Array<string>;
  /** Resolves when `debug.hang` is interrupted. */
  readonly hangInterrupted: Promise<void>;
  /** Resolves when the `debug.infinite` stream is finalized. */
  readonly infiniteFinalized: Promise<void>;
  /** Resolves when the handler layer is released. */
  readonly released: Promise<void>;
}

const deferred = (): { readonly promise: Promise<void>; readonly resolve: () => void } => {
  let settle: (() => void) | undefined;
  const promise = new Promise<void>((r) => {
    settle = r;
  });
  return { promise, resolve: () => settle?.() };
};

export const AuthLive = (events: Array<string> = []) =>
  Layer.succeed(Auth)(
    Auth.of((effect, { headers }) => {
      const name = headers['x-user'];
      events.push(`auth:${name ?? '-'}`);
      return name === undefined || name === ''
        ? Effect.fail(new Unauthorized())
        : Effect.provideService(effect, CurrentUser, { name });
    }),
  );

export const TraceLive = (events: Array<string> = []) =>
  Layer.succeed(Trace)(
    Trace.of((effect, { rpc }) => {
      events.push(`trace:${rpc._tag}`);
      return effect;
    }),
  );

/**
 * The handler layer of `appRouter` (handlers + middleware) and a probe observing it.
 */
export const makeServer = (): {
  readonly layer: Layer.Layer<Handlers.Requirements<AppRouter>>;
  readonly probe: Probe;
} => {
  const events: Array<string> = [];
  const hang = deferred();
  const infinite = deferred();
  const released = deferred();

  const handlers = Handlers.make(
    appRouter,
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.sync(released.resolve));
      return Handlers.of(appRouter, {
        health: () => Effect.succeed('ok' as const),
        user: {
          byId: ({ id }) => {
            if (id === 'ada') return Effect.succeed(ada());
            if (id === 'root') return Effect.fail(new Forbidden({ reason: 'root is private' }));
            return Effect.fail(new NotFound({ id }));
          },
          create: ({ name }) =>
            Effect.succeed(new User({ id: name.toLowerCase(), name, createdAt })),
          list: ({ count }) =>
            Stream.range(1, count).pipe(
              Stream.map((i) => new User({ id: `u${i}`, name: `User ${i}`, createdAt })),
            ),
          me: () =>
            Effect.gen(function* () {
              const user = yield* CurrentUser;
              events.push(`me:${user.name}`);
              return new User({ id: user.name, name: user.name, createdAt });
            }),
        },
        debug: {
          die: () => Effect.die(new Error('boom')),
          hang: () =>
            Effect.never.pipe(
              Effect.onInterrupt(() => Effect.sync(hang.resolve)),
              Effect.as('never'),
            ),
          headers: (_, { headers }) => Effect.succeed({ trace: headers['x-trace'] ?? null }),
          requestId: (_, { requestId }) => Effect.succeed(String(requestId)),
          badOutput: () => Effect.succeed(1.5),
          ping: () => Effect.succeed('pong' as const),
          nullable: () => Stream.make(1, null, 2, null),
          failMidStream: () =>
            Stream.concat(Stream.make(1, 2), Stream.fail(new NotFound({ id: 'stream' }))),
          infinite: () =>
            Stream.iterate(0, (n) => n + 1).pipe(
              Stream.tap(() => Effect.sleep('5 millis')),
              Stream.ensuring(Effect.sync(infinite.resolve)),
            ),
        },
      });
    }),
  );

  return {
    layer: Layer.mergeAll(handlers, AuthLive(events), TraceLive(events)),
    probe: {
      events,
      hangInterrupted: hang.promise,
      infiniteFinalized: infinite.promise,
      released: released.promise,
    },
  };
};

/** Returns the success value or throws (keeps assertions unconditional). */
export const getSuccess = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isFailure(exit)) throw new Error(`Expected a success, got ${Cause.pretty(exit.cause)}`);
  return exit.value;
};

/** Returns the failure cause or throws. */
export const getCause = <A, E>(exit: Exit.Exit<A, E>): Cause.Cause<E> => {
  if (Exit.isSuccess(exit)) throw new Error('Expected a failure, got a success');
  return exit.cause;
};

/** Collects the rejection of a promise (fails when it resolves). */
export const rejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject');
};
