// A nested-records-only router service next to another router.
import { Context, Effect, Schema } from 'effect';
import { Procedure, Router } from '@rpc-effect/core';

export class NestedRouter extends Context.Service<NestedRouter>()('NestedRouter', {
  make: Effect.gen(function* () {
    yield* Effect.void;
    return { a: { b: Procedure.output(Schema.String).query(() => Effect.succeed('b')) } };
  }),
}) {}

export const OtherRouter = Router.make({
  ping: Procedure.output(Schema.String).query(() => Effect.succeed('pong')),
});
