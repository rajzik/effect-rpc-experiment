/**
 * The task board's server side: handlers for every procedure plus the `Auth` middleware.
 *
 * `makeServerLive` is the one layer every adapter takes as `handlers` (route handler, RSC helpers,
 * server actions, Start's server routes, Electron's main process). Apps differ only in how a
 * request names its user: they pass `resolveUser`, e.g. `cookieUser` for cookie sessions.
 */
import { Effect, Layer, Stream } from 'effect';
import { Handlers } from '@effect-trpc/server';

import {
  appRouter,
  Auth,
  CurrentUser,
  Forbidden,
  Unauthorized,
  User,
  ValidationFailed,
  type AppRouter,
} from './domain';
import { store } from './store';

/** The request headers a middleware sees (lower-case names). */
export type RequestHeaders = Readonly<Record<string, string | undefined>>;

/** Options of {@link makeServerLive}. */
export interface ServerOptions {
  /** The user name a request belongs to, or `undefined` when it carries no session. */
  readonly resolveUser: (headers: RequestHeaders) => string | undefined;
}

/** The known users: two members and a guest. */
const users: ReadonlyMap<string, User> = new Map([
  ['ada', new User({ name: 'ada', role: 'member' })],
  ['grace', new User({ name: 'grace', role: 'member' })],
  ['guest', new User({ name: 'guest', role: 'guest' })],
]);

/** Reads the user name from the cookie `session=<name>`. */
export const cookieUser = (headers: RequestHeaders): string | undefined => {
  for (const part of (headers['cookie'] ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === 'session') {
      const decoded = decodeURIComponent(value.join('='));
      return decoded === '' ? undefined : decoded;
    }
  }
  return undefined;
};

const requireMember = Effect.gen(function* () {
  const user = yield* CurrentUser;
  if (user.role === 'guest') return yield* new Forbidden({ reason: 'guests cannot write' });
  return user;
});

const HandlersLive = Handlers.make(appRouter, {
  session: { me: () => Effect.service(CurrentUser) },
  tasks: {
    list: ({ cursor }) => store.list(cursor),
    byId: ({ id }) => store.byId(id),
    create: ({ title }) =>
      Effect.gen(function* () {
        const user = yield* requireMember;
        const trimmed = title.trim();
        if (trimmed === '') {
          return yield* new ValidationFailed({ field: 'title', message: 'must not be empty' });
        }
        return yield* store.create(trimmed, user.name);
      }),
    toggle: ({ id }) =>
      Effect.gen(function* () {
        yield* requireMember;
        return yield* store.toggle(id);
      }),
    // Subscribes when the stream starts, so a client sees every change after it connected.
    onChanged: () => Stream.fromPubSub(store.changes),
  },
  testing: {
    reset: () =>
      Effect.suspend(() =>
        process.env['EXAMPLES_TEST'] === '1'
          ? store.reset
          : Effect.die(
              new Error('testing.reset is disabled: start the server with EXAMPLES_TEST=1'),
            ),
      ),
  },
});

/**
 * Handlers plus the `Auth` middleware, as the one layer adapters take as `handlers`.
 *
 * A request whose `resolveUser` result names no known user fails with `Unauthorized`.
 */
export const makeServerLive = (
  options: ServerOptions,
): Layer.Layer<Handlers.Requirements<AppRouter>> => {
  const AuthLive = Layer.succeed(Auth)(
    Auth.of((effect, { headers }) => {
      const name = options.resolveUser(headers);
      const user = name === undefined ? undefined : users.get(name);
      return user === undefined
        ? Effect.fail(new Unauthorized())
        : Effect.provideService(effect, CurrentUser, user);
    }),
  );
  return Layer.mergeAll(HandlersLive, AuthLive);
};
