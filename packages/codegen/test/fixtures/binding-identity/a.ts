// A nested router with a local schema named `Input`: a string field.
import { Effect, Schema } from 'effect';
import { Procedure, Router } from '@rpc-effect/core';

const Input = Schema.Struct({ text: Schema.String });

export const ARouter = Router.make({
  echo: Procedure.input(Input).query(({ text }) => Effect.succeed(text)),
});
