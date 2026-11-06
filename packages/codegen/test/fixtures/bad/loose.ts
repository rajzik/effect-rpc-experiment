// A router make whose generator returns a variable: the generator cannot read the record.
import { Context, Effect } from 'effect';
import { Procedure } from '@effect-trpc/core';

export class LooseRouter extends Context.Service<LooseRouter>()('LooseRouter', {
  make: Effect.gen(function* () {
    yield* Effect.void;
    const routes = { ping: Procedure.query(() => Effect.void) };
    return routes;
  }),
}) {}
