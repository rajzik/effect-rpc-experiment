// A nested record with a procedure named `make`, next to another router.
import { Context, Effect, Schema } from 'effect';
import { Procedure, Router } from '@effect-trpc/core';

export class NestedRouter extends Context.Service<NestedRouter>()('NestedRouter', {
  make: Effect.succeed({
    admin: { make: Procedure.output(Schema.String).mutation(() => Effect.succeed('made')) },
  }),
}) {}

export const OtherRouter = Router.make({
  ping: Procedure.output(Schema.String).query(() => Effect.succeed('pong')),
});
