// Another nested router with its own local schema named `Input`: a number field. Its `Schema` is
// imported from models.ts, a different import than the one a.ts names `Schema`.
import { Effect } from 'effect';
import { Procedure, Router } from '@rpc-effect/core';

import { Schema } from './models.js';

const Input = Schema.Struct({ count: Schema.Finite });

export const BRouter = Router.make({
  double: Procedure.input(Input).query(({ count }) => Effect.succeed(count * 2)),
});
