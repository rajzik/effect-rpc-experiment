// Issue #17: local schemas that use other local schemas. The client module copies them in the
// router module's order, so each one is declared after the schemas it reads when it is created.
import { Effect, Schema } from 'effect';
import { Procedure, Router } from '@rpc-effect/core';

const Id = Schema.String;
const Input = Schema.Struct({ id: Id });

// A cycle: `Tree` reads `Forest` lazily, `Forest` reads `Tree` when it is created.
const Tree = Schema.Struct({
  value: Schema.Finite,
  forest: Schema.suspend((): Schema.Codec<unknown> => Forest),
});
const Forest = Schema.Array(Tree);

export const AppRouter = Router.make({
  byId: Procedure.input(Input).query(({ id }) => Effect.succeed(id)),
  tree: Procedure.input(Tree).query(({ value }) => Effect.succeed(value)),
});
