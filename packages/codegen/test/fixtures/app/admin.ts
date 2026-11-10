import { Context, Effect } from 'effect';
import { Procedure } from '@rpc-effect/core';

import { db } from './db.js';

export class AdminRouter extends Context.Service<AdminRouter>()('AdminRouter', {
  make: Effect.succeed({
    count: Procedure.query(() => Effect.succeed(db.posts.length)),
  }),
}) {}
