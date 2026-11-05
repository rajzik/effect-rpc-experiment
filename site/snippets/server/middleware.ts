import { Context, Effect, Layer, Schema } from 'effect';
import { query, Router } from '@effect-trpc/core';
import { createCaller, Handlers, Middleware } from '@effect-trpc/server';

// #region declare
class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}

class Session extends Context.Service<
  Session,
  { readonly userId: string; readonly role: string }
>()('Session') {}

// `provides`: services handlers can `yield*`. `error`: added to every procedure using it.
class Authenticated extends Middleware.make<Authenticated, { provides: Session }>()(
  'Authenticated',
  { error: Unauthorized },
) {}
// #endregion declare

// #region attach
const router = Router.make({
  public: { ping: query({ success: Schema.String }) },
  account: Router.make({
    me: query({ success: Schema.String }),
    role: query({ success: Schema.String }),
  }).middleware(Authenticated), // every procedure under `account`
});
// #endregion attach

// #region implement
// A middleware service that itself needs a service: it stays a requirement of the layer.
class Sessions extends Context.Service<
  Sessions,
  { readonly fromToken: (token: string) => Effect.Effect<Session['Service'], Unauthorized> }
>()('Sessions') {}

const AuthenticatedLive = Layer.effect(Authenticated)(
  Effect.gen(function* () {
    const sessions = yield* Sessions;
    // (effect, { headers, payload, rpc, requestId, client }) => Effect
    return Authenticated.of((effect, { headers }) => {
      const token = headers['authorization']?.replace(/^Bearer /, '');
      if (token === undefined) return Effect.fail(new Unauthorized());
      return Effect.flatMap(sessions.fromToken(token), (session) =>
        Effect.provideService(effect, Session, session),
      );
    });
  }),
);
// #endregion implement

// #region handlers
const HandlersLive = Handlers.make(router, {
  public: { ping: () => Effect.succeed('pong') },
  account: {
    me: () =>
      Effect.gen(function* () {
        const session = yield* Session; // provided by the middleware
        return session.userId;
      }),
    role: () =>
      Effect.gen(function* () {
        const session = yield* Session;
        return session.role;
      }),
  },
});

const SessionsLive = Layer.succeed(Sessions)({
  fromToken: (token) =>
    token === 'ada-token'
      ? Effect.succeed({ userId: 'ada', role: 'admin' })
      : Effect.fail(new Unauthorized()),
});

// Handlers + middleware implementations, with their services provided.
const ServerLive = Layer.mergeAll(HandlersLive, AuthenticatedLive).pipe(
  Layer.provide(SessionsLive),
);
// #endregion handlers

// #region call
const caller = createCaller(router, { handlers: ServerLive });
await caller.$promise.account.me(undefined, { headers: { authorization: 'Bearer ada-token' } }); // "ada"
await caller.$promise.account.me(); // rejects with Unauthorized
await caller.dispose();
// #endregion call
