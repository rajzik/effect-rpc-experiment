import { Context, Effect, Layer, Schema } from 'effect';
import { Procedure, query, Router } from '@effect-trpc/core';
import { createCaller, Handlers, Middleware } from '@effect-trpc/server';

// #region declare
class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {}) {}

// The key. A `Context.Reference` gives procedures that don't set it a default.
const Roles = Context.Reference<ReadonlyArray<string>>('Roles', { defaultValue: () => [] });

class RequireRoles extends Middleware.make<RequireRoles>()('RequireRoles', { error: Forbidden }) {}
// #endregion declare

// #region annotate
const appRouter = Router.make({
  health: query({ success: Schema.Literal('ok') }),
  stats: query({ success: Schema.Finite }).annotate(Roles, ['admin']),
}).middleware(RequireRoles);

// The builder takes `.annotate` at any step.
const purge = Procedure.annotate(Roles, ['admin'])
  .output(Schema.Void)
  .mutation(() => Effect.void);
// #endregion annotate

// #region implement
const RequireRolesLive = Layer.succeed(RequireRoles)(
  RequireRoles.of((effect, { rpc, headers }) => {
    const granted = headers['x-roles']?.split(',') ?? [];
    const required = Context.get(rpc.annotations, Roles);
    return required.every((role) => granted.includes(role)) ? effect : Effect.fail(new Forbidden());
  }),
);
// #endregion implement

// #region call
const HandlersLive = Handlers.make(appRouter, {
  health: () => Effect.succeed('ok' as const),
  stats: () => Effect.succeed(42),
});
const caller = createCaller(appRouter, {
  handlers: Layer.mergeAll(HandlersLive, RequireRolesLive),
});

await caller.$promise.health(); // "ok": no roles required
await caller.$promise.stats(); // rejects with Forbidden
await caller.$promise.stats(undefined, { headers: { 'x-roles': 'admin' } }); // 42
await caller.dispose();
// #endregion call

void purge;
