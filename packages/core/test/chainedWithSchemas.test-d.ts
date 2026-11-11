// Chained `Router.withSchemas` overlays keep the schema types of the earlier ones they do not
// replace, over a router service as over a plain router.
import { Context, Effect, Schema } from 'effect';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import { Procedure, Router } from '../src/index.js';
import type { inferError, inferOutput } from '../src/index.js';

class Missing extends Schema.TaggedError<Missing>()('Missing', {}) {}

const procedures = {
  a: Procedure.query(() => Effect.succeed('first')),
  b: Procedure.query(() => Effect.succeed(2)),
  nested: {
    c: Procedure.query(() => Effect.succeed(true)),
    d: Procedure.query(() => Effect.fail(new Missing())),
  },
};

class App extends Context.Service<App>()('App', { make: Effect.succeed(procedures) }) {}

const firstSchemas = {
  a: { output: Schema.String },
  nested: { c: { output: Schema.Boolean }, d: { output: Schema.String } },
};
const secondSchemas = { b: { output: Schema.Finite }, nested: { d: { error: Missing } } };

describe('chained Router.withSchemas types', () => {
  it('keeps the earlier schema types over a router service, as over a router', () => {
    const first = Router.withSchemas(App, firstSchemas);
    const { record } = Router.from(Router.withSchemas(first, secondSchemas));
    expectTypeOf(record.a.successSchema).toEqualTypeOf<Schema.String>();
    expectTypeOf<inferOutput<typeof record.a>>().toEqualTypeOf<string>();
    expectTypeOf(record.b.successSchema).toEqualTypeOf<Schema.Finite>();
    expectTypeOf(record.nested.c.successSchema).toEqualTypeOf<Schema.Boolean>();
    expectTypeOf(record.nested.d.successSchema).toEqualTypeOf<Schema.String>();
    expectTypeOf<inferError<typeof record.nested.d>>().toEqualTypeOf<Missing>();

    const plain = Router.withSchemas(
      Router.withSchemas(Router.make(procedures), firstSchemas),
      secondSchemas,
    );
    expectTypeOf(record).toEqualTypeOf(plain.record);
  });
});
