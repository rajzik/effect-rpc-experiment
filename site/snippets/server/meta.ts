import { Context, Effect, Layer, Schema } from 'effect';
import { Procedure, query, Router } from '@rpc-effect/core';
import { createCaller, Handlers, Middleware } from '@rpc-effect/server';

// #region declare
class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {}) {}

// The key. A `Context.Reference` gives procedures that don't set it a default.
const Roles = Context.Reference<ReadonlyArray<string>>('Roles', { defaultValue: () => [] });

// Who is calling: provided by an auth middleware (or `Handlers.withContext`), never read
// from a client-sent header.
class CurrentUser extends Context.Service<CurrentUser, { readonly roles: ReadonlyArray<string> }>()(
  'CurrentUser',
) {}
class Authenticated extends Middleware.make<Authenticated, { provides: CurrentUser }>()(
  'Authenticated',
) {}

// `requires`: its implementation reads `CurrentUser`.
class RequireRoles extends Middleware.make<RequireRoles, { requires: CurrentUser }>()(
  'RequireRoles',
  { error: Forbidden },
) {}
// #endregion declare

// #region annotate
const appRouter = Router.make({
  health: query({ success: Schema.Literal('ok') }),
  stats: query({ success: Schema.Finite }).annotate(Roles, ['admin']),
})
  .middleware(RequireRoles)
  .middleware(Authenticated); // added last, runs first: provides `CurrentUser` to `RequireRoles`

// The builder takes `.annotate` at any step.
const purge = Procedure.annotate(Roles, ['admin'])
  .output(Schema.Void)
  .mutation(() => Effect.void);
// #endregion annotate

// #region implement
const RequireRolesLive = Layer.succeed(RequireRoles)(
  RequireRoles.of((effect, { rpc }) =>
    Effect.flatMap(CurrentUser, (user) => {
      const required = Context.get(rpc.annotations, Roles);
      return required.every((role) => user.roles.includes(role))
        ? effect
        : Effect.fail(new Forbidden());
    }),
  ),
);

// Roles come from the server's session store; an unknown or missing token gets no roles.
const sessions = new Map([['ada-token', { roles: ['admin'] }]]);
const AuthenticatedLive = Layer.succeed(Authenticated)(
  Authenticated.of((effect, { headers }) => {
    const auth = headers['authorization'] ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
    return Effect.provideService(effect, CurrentUser, sessions.get(token) ?? { roles: [] });
  }),
);
// #endregion implement

// #region call
const HandlersLive = Handlers.make(appRouter, {
  health: () => Effect.succeed('ok' as const),
  stats: () => Effect.succeed(42),
});
const caller = createCaller(appRouter, {
  handlers: Layer.mergeAll(HandlersLive, RequireRolesLive, AuthenticatedLive),
});

await caller.$promise.health(); // "ok": no roles required
await caller.$promise.stats(); // rejects with Forbidden
await caller.$promise.stats(undefined, { headers: { authorization: 'Bearer ada-token' } }); // 42
await caller.dispose();
// #endregion call

void purge;
