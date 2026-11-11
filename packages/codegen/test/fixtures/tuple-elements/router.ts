// Tuples with optional and rest elements (issue #16): the generated schemas must accept every
// value the handler types allow.
import { Effect } from 'effect';
import { Procedure, Router } from '@rpc-effect/core';

const optional: [number, string?] = [1];
const rest: [number, ...string[]] = [1, 'a', 'b'];
const trailing: [...string[], number] = ['a', 'b', 1];

export const AppRouter = Router.make({
  optional: Procedure.query(() => Effect.succeed(optional)),
  rest: Procedure.query(() => Effect.succeed(rest)),
  trailing: Procedure.query(() => Effect.succeed(trailing)),
});
