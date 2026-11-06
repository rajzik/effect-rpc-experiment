// Every procedure here has an output the generator cannot map.
import { Context, Effect, Schema } from 'effect';
import { Procedure } from '@effect-trpc/core';

class Plain {
  constructor(readonly n: number) {}
}

// A Schema class declared in the router module: fine for the server, not for the client.
class Local extends Schema.Class<Local>('Local')({ n: Schema.Finite }) {}

enum Status {
  Active = 'active',
}

interface Node {
  readonly next: Node | null;
}
const node: Node = { next: null };

export class BadRouter extends Context.Service<BadRouter>()('BadRouter', {
  make: Effect.succeed({
    plain: Procedure.query(() => Effect.succeed(new Plain(1))),
    fn: Procedure.query(() => Effect.succeed({ run: () => 1 })),
    local: Procedure.input(Local).query(() => Effect.void),
    recursive: Procedure.query(() => Effect.succeed(node)),
    status: Procedure.query(() => Effect.succeed(Status.Active)),
  }),
}) {}
