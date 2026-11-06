import { Context, Effect, Schema, Stream } from 'effect';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import { Procedure, query, Router } from '../src/index.js';
import type { inferError, inferOutput, ProcedureWithHandler } from '../src/index.js';
import { AuthMiddleware, Post, PostNotFound, Unauthorized } from './fixtures.js';

const post = new Post({ id: 1, title: 'Hello', createdAt: new Date(0) });

class Admin extends Context.Service<Admin>()('Admin', {
  make: Effect.succeed({ count: Procedure.query(() => Effect.succeed(3)) }),
}) {}

class App extends Context.Service<App>()('App', {
  make: Effect.succeed({
    byId: Procedure.input({ id: Schema.Finite }).query(({ id }) =>
      id === 1 ? Effect.succeed(post) : Effect.fail(new PostNotFound({ id })),
    ),
    first: Procedure.error(PostNotFound)
      .middleware(AuthMiddleware)
      .query(() => Effect.succeed(post)),
    legacy: query({ success: Schema.String }),
    feed: Procedure.subscription(() => Stream.make(post)),
    admin: Admin,
  }),
}) {}

describe('Router.withSchemas types', () => {
  it('replaces the schema types of the given paths only', () => {
    const out = Router.withSchemas(App, {
      byId: { output: Post, error: PostNotFound },
      first: { output: Post },
      admin: { count: { output: Schema.Finite } },
    });
    expectTypeOf(out.record.byId.successSchema).toEqualTypeOf<typeof Post>();
    expectTypeOf<inferError<typeof out.record.byId>>().toEqualTypeOf<PostNotFound>();
    expectTypeOf<inferError<typeof out.record.first>>().toEqualTypeOf<
      PostNotFound | Unauthorized
    >();
    expectTypeOf<inferOutput<typeof out.record.admin.record.count>>().toEqualTypeOf<number>();
    expectTypeOf(out.record.admin.record.count.successSchema).toEqualTypeOf<Schema.Finite>();
    // not given: unchanged (the inferred `Schema.declare<Post>` of the stream elements)
    expectTypeOf(out.record.feed).toEqualTypeOf<Router.Of<typeof App>['record']['feed']>();
    expectTypeOf(out.record.legacy).toEqualTypeOf<Router.Of<typeof App>['record']['legacy']>();
    expectTypeOf(out.record.byId).toExtend<
      ProcedureWithHandler<
        'query',
        Schema.Struct<{ id: typeof Schema.Finite }>,
        typeof Post,
        typeof PostNotFound,
        never,
        never,
        never
      >
    >();
  });

  it('rejects paths that are not procedures with handlers', () => {
    // @ts-expect-error -- no such procedure
    Router.withSchemas(App, { missing: { output: Post } });
    // @ts-expect-error -- `legacy` is a schema-only definition
    Router.withSchemas(App, { legacy: { output: Schema.String } });
    // @ts-expect-error -- `output` must be a schema
    Router.withSchemas(App, { byId: { output: 1 } });
    expectTypeOf(Router.withSchemas).toBeFunction();
  });
});
