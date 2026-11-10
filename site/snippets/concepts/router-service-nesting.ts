import { Context, Effect, Schema } from 'effect';
import { Procedure, query, Router } from '@rpc-effect/core';
import { Handlers } from '@rpc-effect/server';

// #region nesting
// A service router inside another service's `make`…
export class AdminRouter extends Context.Service<AdminRouter>()('AdminRouter', {
  make: Effect.succeed({
    userCount: Procedure.output(Schema.Finite).query(() => Effect.succeed(42)),
    purge: Procedure.output(Schema.Finite).mutation(() => Effect.succeed(0)),
  }),
}) {}

export class RootRouter extends Context.Service<RootRouter>()('RootRouter', {
  make: Effect.succeed({
    health: Procedure.output(Schema.Literal('ok')).query(() => Effect.succeed('ok' as const)),
    admin: AdminRouter, // tags "admin.userCount", "admin.purge"
    nested: { deep: { ping: Procedure.output(Schema.String).query(() => Effect.succeed('pong')) } },
  }),
}) {}

// …or inside a plain `Router.make`, next to ordinary routers.
export const mixedRouter = Router.make({
  admin: AdminRouter,
  health: query({ success: Schema.Literal('ok') }), // a definition without a handler
});

// Router.Of maps a service class (or a router) to its router type.
export type RootRouterType = Router.Of<typeof RootRouter>;
// #endregion nesting

// #region mixed
// `Handlers.fromProcedures` rejects this router: `health` has no handler. Implement it with
// `Handlers.make` and reuse the handlers the builder procedures already carry.
export const MixedLive = Handlers.make(mixedRouter, {
  admin: {
    userCount: Router.from(AdminRouter).record.userCount.handler,
    purge: Router.from(AdminRouter).record.purge.handler,
  },
  health: () => Effect.succeed('ok' as const),
});
// #endregion mixed
