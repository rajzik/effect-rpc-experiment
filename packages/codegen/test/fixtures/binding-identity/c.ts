// A nested router whose `Input` is an import, not a local.
import { Effect } from 'effect';
import { Procedure, Router } from '@rpc-effect/core';

import { Input } from './models.js';

export const CRouter = Router.make({
  negate: Procedure.input(Input).query(({ flag }) => Effect.succeed(!flag)),
});
