import { Context, Effect, Schema, Stream } from 'effect';
import type { Rpc } from 'effect/rpc';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import { Procedure, query, Router } from '../src/index.js';
import type { inferError, inferOutput, ProcedureWithHandler, RouterService } from '../src/index.js';
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

class DbError extends Schema.TaggedError<DbError>()('DbError', {}) {}

class Database extends Context.Service<
  Database,
  { readonly ready: Effect.Effect<void, DbError>; readonly latest: Effect.Effect<Post> }
>()('Database') {}

class DbRouter extends Context.Service<DbRouter>()('DbRouter', {
  make: Effect.gen(function* () {
    const db = yield* Database;
    yield* db.ready;
    return { latest: Procedure.query(() => db.latest) };
  }),
}) {}

describe('Router.withSchemas types', () => {
  it('replaces the schema types of the given paths only', () => {
    const wrapped = Router.withSchemas(App, {
      byId: { output: Post, error: PostNotFound },
      first: { output: Post },
      admin: { count: { output: Schema.Finite } },
    });
    const out = Router.from(wrapped);
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

  it('over a router service, returns a service (pure for a pure source)', () => {
    const wrapped = Router.withSchemas(App, { byId: { output: Post } });
    expectTypeOf(wrapped).toExtend<Router.Input>();
    expectTypeOf<RouterService.MakeServices<typeof wrapped>>().toEqualTypeOf<never>();
    expectTypeOf<Context.Service.Identifier<typeof wrapped>>().toEqualTypeOf<App>();
    const router = Router.withSchemas(Router.from(App), { byId: { output: Post } });
    expectTypeOf(router.record.byId.successSchema).toEqualTypeOf<typeof Post>();
  });

  it('over an effectful service, keeps its make error and services', () => {
    const wrapped = Router.withSchemas(DbRouter, { latest: { output: Post } });
    type Latest = Rpc.ExtractTag<Router.Rpcs<typeof wrapped>, 'latest'>;
    expectTypeOf<Rpc.Success<Latest>>().toEqualTypeOf<Post>();
    expectTypeOf<RouterService.MakeServices<typeof wrapped>>().toEqualTypeOf<
      RouterService.MakeServices<typeof DbRouter>
    >();
    expectTypeOf<RouterService.MakeServices<typeof wrapped>>().toEqualTypeOf<Database>();
    expectTypeOf<RouterService.MakeError<typeof wrapped>>().toEqualTypeOf<DbError>();
    expectTypeOf(wrapped).toExtend<RouterService.Effectful>();
    expectTypeOf(wrapped).not.toExtend<Router.Input>();
    // @ts-expect-error -- no such procedure
    Router.withSchemas(DbRouter, { missing: { output: Post } });
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
