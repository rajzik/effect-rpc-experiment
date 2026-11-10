// The module's only router service: its make returns nested plain records, no top-level procedure.
import { Context, Effect, Schema } from 'effect';
import { Procedure } from '@rpc-effect/core';

export class NestedRouter extends Context.Service<NestedRouter>()('NestedRouter', {
  make: Effect.succeed({
    a: { b: Procedure.output(Schema.String).query(() => Effect.succeed('b')) },
  }),
}) {}
