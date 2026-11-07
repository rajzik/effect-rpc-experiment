// `.annotate` is runtime-only metadata: it never changes a definition's or builder's type.
import { Context, Effect, Schema } from 'effect';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import { Procedure, query } from '../src/index.js';
import { AuthMiddleware } from './fixtures.js';

const Roles = Context.Reference<ReadonlyArray<string>>('test/Roles', { defaultValue: () => [] });

describe('annotate types', () => {
  it('returns the same definition type', () => {
    const def = query({ payload: { id: Schema.Finite }, success: Schema.String }).middleware(
      AuthMiddleware,
    );
    expectTypeOf(def.annotate(Roles, ['admin'])).toEqualTypeOf<typeof def>();
  });

  it('keeps a builder procedure (with its handler requirements)', () => {
    const def = Procedure.output(Schema.String).query(() => Effect.succeed('ok'));
    expectTypeOf(def.annotate(Roles, ['admin'])).toEqualTypeOf<typeof def>();
  });

  it('keeps the builder type at every step', () => {
    expectTypeOf(Procedure.annotate(Roles, ['admin'])).toEqualTypeOf<
      Procedure.Builder<Schema.Void, Schema.Void, Schema.Never, never, never, Procedure.Infer>
    >();
    const builder = Procedure.output(Schema.String).middleware(AuthMiddleware);
    expectTypeOf(builder.annotate(Roles, ['admin'])).toEqualTypeOf<typeof builder>();
  });

  it('checks the value against the key', () => {
    const def = query({ success: Schema.String });
    expectTypeOf(def.annotate(Roles, [])).toEqualTypeOf<typeof def>();
    // @ts-expect-error -- a number is not `ReadonlyArray<string>`
    def.annotate(Roles, 1);
    // @ts-expect-error -- a number is not `ReadonlyArray<string>`
    Procedure.annotate(Roles, 1);
  });
});
