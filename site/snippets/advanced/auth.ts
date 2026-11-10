// Authentication end to end: a bearer token → a typed User service → typed errors on the client.
import { Context, Effect, Layer, Schema } from 'effect';
import { RpcMiddleware } from 'effect/rpc';
import { mutation, query, Router } from '@rpc-effect/core';
import { createClient, httpLink } from '@rpc-effect/client';
import { Handlers, toWebHandler } from '@rpc-effect/server';

// #region shared
// router.ts — shared
export class User extends Schema.Class<User>('User')({
  id: Schema.String,
  role: Schema.Literals(['member', 'admin']),
}) {}
export class Unauthenticated extends Schema.TaggedError<Unauthenticated>()('Unauthenticated', {}) {}
export class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {
  required: Schema.String,
}) {}

export class CurrentUser extends Context.Service<CurrentUser, User>()('CurrentUser') {}

// Authenticate: who is calling. Provides CurrentUser.
export class Authenticate extends RpcMiddleware.Service<Authenticate, { provides: CurrentUser }>()(
  'Authenticate',
  { error: Unauthenticated },
) {}

// RequireAdmin: what they may do. Needs CurrentUser, so it must run after Authenticate.
export class RequireAdmin extends RpcMiddleware.Service<RequireAdmin, { requires: CurrentUser }>()(
  'RequireAdmin',
  { error: Forbidden },
) {}

export const appRouter = Router.make({
  me: query({ success: User }).middleware(Authenticate),
  admin: Router.make({
    deleteUser: mutation({ payload: { id: Schema.String } }),
  })
    .middleware(RequireAdmin)
    .middleware(Authenticate), // added last, so it runs first
});
// #endregion shared

// #region server
// server.ts — server only
class Tokens extends Context.Service<
  Tokens,
  { readonly verify: (token: string) => Effect.Effect<User, Unauthenticated> }
>()('Tokens') {}

const AuthenticateLive = Layer.effect(Authenticate)(
  Effect.gen(function* () {
    const tokens = yield* Tokens;
    return Authenticate.of((effect, { headers }) => {
      const token = headers['authorization']?.match(/^Bearer (.+)$/)?.[1];
      if (token === undefined) return Effect.fail(new Unauthenticated());
      return Effect.flatMap(tokens.verify(token), (user) =>
        Effect.provideService(effect, CurrentUser, user),
      );
    });
  }),
);

const RequireAdminLive = Layer.succeed(RequireAdmin)(
  RequireAdmin.of((effect) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser;
      if (user.role !== 'admin') return yield* new Forbidden({ required: 'admin' });
      return yield* effect;
    }),
  ),
);

const HandlersLive = Handlers.make(appRouter, {
  me: () => CurrentUser, // a service key is an Effect of the service; provided by Authenticate
  admin: { deleteUser: () => Effect.void },
});

const TokensLive = Layer.succeed(Tokens)({
  verify: (token) =>
    token === 'admin-token'
      ? Effect.succeed(new User({ id: 'ada', role: 'admin' }))
      : token === 'member-token'
        ? Effect.succeed(new User({ id: 'bob', role: 'member' }))
        : Effect.fail(new Unauthenticated()),
});

export const ServerLive = Layer.mergeAll(HandlersLive, AuthenticateLive, RequireAdminLive).pipe(
  Layer.provide(TokensLive),
);
export const { handler } = await toWebHandler(appRouter, { handlers: ServerLive });
// #endregion server

// #region client
// client.ts
declare const session: { token(): Promise<string | undefined> };

const client = createClient(appRouter, {
  link: httpLink({ url: 'https://api.example.com/rpc' }),
  headers: async () => {
    const token = await session.token();
    return token === undefined ? {} : { authorization: `Bearer ${token}` };
  },
});

try {
  await client.admin.deleteUser({ id: 'bob' });
} catch (cause) {
  // Both middleware errors are in the type: ClientError<Forbidden | Unauthenticated>
  if (cause instanceof Unauthenticated) console.log('sign in');
  if (cause instanceof Forbidden) console.log(`needs ${cause.required}`);
}
// #endregion client
