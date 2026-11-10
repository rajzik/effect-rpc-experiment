// Every procedure here has a schema the generator cannot map.
import { Context, Effect, Schema } from 'effect';
import { Procedure } from '@rpc-effect/core';

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

const ById = Schema.Struct({ id: Schema.Finite });
class AppConfig extends Context.Service<AppConfig, { readonly schema: typeof ById }>()(
  'AppConfig',
) {}

// Schemas built from values declared in `make`: the client cannot have them.
class InnerRouter extends Context.Service<InnerRouter>()('InnerRouter', {
  make: Effect.gen(function* () {
    const limits = yield* AppConfig;
    return { byId: Procedure.input(limits.schema).query(() => Effect.void) };
  }),
}) {}

export class ConfigRouter extends Context.Service<ConfigRouter>()('ConfigRouter', {
  make: Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const Key = Schema.Struct({ key: Schema.String });
    return {
      byId: Procedure.input(cfg.schema).query(() => Effect.void),
      byKey: Procedure.input(Key).query(() => Effect.void),
      inner: InnerRouter,
    };
  }),
}) {}
