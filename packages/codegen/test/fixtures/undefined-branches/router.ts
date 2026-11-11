// Handlers whose branches succeed with `undefined` (issue #13).
import { Context, Effect, Schema } from 'effect';
import { Procedure } from '@rpc-effect/core';

export class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.succeed({
    // One branch carries a value: the output keeps the `undefined` branch.
    maybe: Procedure.input({ empty: Schema.Boolean }).query(({ empty }) =>
      empty ? Effect.undefined : Effect.succeed(1),
    ),
    // Every branch is void-like: no output schema.
    none: Procedure.input({ empty: Schema.Boolean }).mutation(({ empty }) =>
      empty ? Effect.void : Effect.undefined,
    ),
  }),
}) {}
