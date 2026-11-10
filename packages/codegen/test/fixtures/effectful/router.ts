// Router services whose `make` reads a service (`Effect.gen`): schemas are inferred all the same.
import { Context, Effect, Schema } from 'effect';
import { Procedure } from '@rpc-effect/core';

import { Database } from './db.js';

export class PostRouter extends Context.Service<PostRouter>()('PostRouter', {
  make: Effect.gen(function* () {
    const db = yield* Database;
    return {
      byId: Procedure.input({ id: Schema.Finite }).query(({ id }) => db.find(id)),
    };
  }),
}) {}

// A nested effectful service: inlined into the client contract.
export class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.gen(function* () {
    const db = yield* Database;
    return {
      count: Procedure.query(() => db.count),
      post: PostRouter,
    };
  }),
}) {}

// An ordinary service next to the routers (its make returns no procedures): not a router.
export class Cache extends Context.Service<Cache>()('Cache', {
  make: Effect.gen(function* () {
    const db = yield* Database;
    return { count: db.count, label: { name: 'cache' } };
  }),
}) {}
