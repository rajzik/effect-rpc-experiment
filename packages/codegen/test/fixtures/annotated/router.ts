// Annotated procedures (tRPC meta) next to plain ones and another router. A trailing
// `.annotate(...)` reads like a trailing `.middleware(...)`; the client module drops annotations.
import { Effect, Schema } from 'effect';
import { Procedure, query, Router } from '@rpc-effect/core';
import { Log, Roles } from './meta.js';

export const AppRouter = Router.make({
  stats: Procedure.query(() => Effect.succeed(1))
    .annotate(Roles, ['admin'])
    .middleware(Log),
  early: Procedure.annotate(Roles, ['admin']).query(() => Effect.succeed('early')),
  status: query({ success: Schema.String }).annotate(Roles, ['admin']),
  plain: Procedure.query(() => Effect.succeed('plain')),
});

export const OtherRouter = Router.make({
  ping: Procedure.output(Schema.String).query(() => Effect.succeed('pong')),
});
