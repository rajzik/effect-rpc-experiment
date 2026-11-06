// Returns schema classes from other packages without importing them.
import { Context, Effect, Schema } from 'effect';
import { Procedure } from '@effect-trpc/core';
import { findUser } from '@fx/models';
import { price } from 'vendor-lib';

export class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.succeed({
    user: Procedure.input({ id: Schema.Finite }).query(({ id }) => findUser(id)),
    price: Procedure.query(() => price(1999)),
  }),
}) {}
