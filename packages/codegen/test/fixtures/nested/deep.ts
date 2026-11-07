// A procedure nine records deep, next to another router.
import { Context, Effect, Schema } from 'effect';
import { Procedure, Router } from '@effect-trpc/core';

export class NestedRouter extends Context.Service<NestedRouter>()('NestedRouter', {
  make: Effect.succeed({
    a: {
      b: {
        c: {
          d: {
            e: {
              f: {
                g: {
                  h: { i: Procedure.output(Schema.String).query(() => Effect.succeed('deep')) },
                },
              },
            },
          },
        },
      },
    },
  }),
}) {}

export const OtherRouter = Router.make({
  ping: Procedure.output(Schema.String).query(() => Effect.succeed('pong')),
});
