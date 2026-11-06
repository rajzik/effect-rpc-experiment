import { Context, Effect, Schema } from 'effect';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import { mutation, Procedure, query, Router } from '../src/index.js';
import type {
  inferRouterErrors,
  inferRouterInputs,
  inferRouterOutputs,
  ProcedureWithHandler,
  RouterService,
} from '../src/index.js';
import { LogMiddleware, Post, PostNotFound } from './fixtures.js';

class Database extends Context.Service<
  Database,
  { readonly findPost: (id: number) => Effect.Effect<Post, PostNotFound> }
>()('Database') {}

// No `as const` anywhere: the record keys are literal anyway.
class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.succeed({
    health: query({ success: Schema.Literal('ok') }),
    post: {
      byId: Procedure.input({ id: Schema.Finite })
        .output(Post)
        .error(PostNotFound)
        .query(
          Effect.fn(function* ({ id }) {
            const db = yield* Database;
            return yield* db.findPost(id);
          }),
        ),
      create: Procedure.input({ title: Schema.String })
        .output(Post)
        .mutation(({ title }) =>
          Effect.succeed(new Post({ id: 2, title, createdAt: new Date(0) })),
        ),
    },
  }),
}) {}

class AdminRouter extends Context.Service<AdminRouter>()('AdminRouter', {
  make: Effect.succeed({ x: Procedure.output(Schema.Finite).query(() => Effect.succeed(1)) }),
}) {}

class NeedsDb extends Context.Service<NeedsDb>()('NeedsDb', {
  make: Effect.gen(function* () {
    yield* Database;
    return { ping: query({ success: Schema.String }) };
  }),
}) {}

class MayFail extends Context.Service<MayFail>()('MayFail', {
  make: Effect.fail('boom').pipe(Effect.as({ ping: query({ success: Schema.String }) })),
}) {}

const plain = Router.make({
  health: query({ success: Schema.Literal('ok') }),
  post: {
    byId: query({ payload: { id: Schema.Finite }, success: Post, error: PostNotFound }),
    create: mutation({ payload: { title: Schema.String }, success: Post }),
  },
});

// Generic adapter code (Task 4 shape): a deferred `Router.Of<R>` must be usable as `Router.Any`.
const normalise = <R extends Router.Input>(input: R): readonly [R, Router.Any] => [
  input,
  Router.from(input),
];

// Pre-existing generic code over `Router.Shape`: `Router.make` must keep returning `Router<Rec>`.
const makeGeneric = <const Rec extends Router.Shape>(record: Rec): Router<Rec> =>
  Router.make(record);

describe('router services (types)', () => {
  it('infers the router from make without as const', () => {
    expectTypeOf<Router.Paths<typeof AppRouter>>().toEqualTypeOf<
      'health' | 'post.byId' | 'post.create'
    >();
    expectTypeOf<inferRouterInputs<typeof AppRouter>['post']['byId']>().toEqualTypeOf<{
      readonly id: number;
    }>();
    expectTypeOf<inferRouterOutputs<typeof AppRouter>['post']['byId']>().toEqualTypeOf<Post>();
    expectTypeOf<
      inferRouterErrors<typeof AppRouter>['post']['byId']
    >().toEqualTypeOf<PostNotFound>();
    expectTypeOf<inferRouterOutputs<typeof AppRouter>['health']>().toEqualTypeOf<'ok'>();
  });

  it('typeof Svc works with inferRouterInputs and Router.Paths', () => {
    expectTypeOf<inferRouterInputs<typeof AppRouter>>().toEqualTypeOf<
      inferRouterInputs<typeof plain>
    >();
    expectTypeOf<inferRouterOutputs<typeof AppRouter>>().toEqualTypeOf<
      inferRouterOutputs<typeof plain>
    >();
    expectTypeOf<inferRouterErrors<typeof AppRouter>>().toEqualTypeOf<
      inferRouterErrors<typeof plain>
    >();
    expectTypeOf<Router.Paths<typeof AppRouter>>().toEqualTypeOf<Router.Paths<typeof plain>>();
    expectTypeOf<Router.Rpcs<typeof AppRouter>>().toEqualTypeOf<Router.Rpcs<typeof plain>>();
    expectTypeOf<Router.Paths<Router.Of<typeof AppRouter>>>().toEqualTypeOf<
      'health' | 'post.byId' | 'post.create'
    >();
  });

  it('Router.Of, Router.from and Router.fromService agree', () => {
    const fromService = Router.fromService(AppRouter);
    const from = Router.from(AppRouter);
    expectTypeOf(fromService).toEqualTypeOf<Router.Of<typeof AppRouter>>();
    expectTypeOf(from).toEqualTypeOf<Router.Of<typeof AppRouter>>();
    expectTypeOf(Router.from(plain)).toEqualTypeOf<typeof plain>();
    expectTypeOf<Router.Of<typeof plain>>().toEqualTypeOf<typeof plain>();
    expectTypeOf(fromService).toExtend<Router.Any>();
    expectTypeOf(fromService.record.post.byId).toExtend<ProcedureWithHandler.Any>();
    expectTypeOf<Router.Record<typeof AppRouter>>().toEqualTypeOf<
      Router.Record<Router.Of<typeof AppRouter>>
    >();
  });

  it('services and routers are Router.Input', () => {
    expectTypeOf<typeof AppRouter>().toExtend<Router.Input>();
    expectTypeOf<typeof AppRouter>().toExtend<RouterService.Any>();
    expectTypeOf<typeof plain>().toExtend<Router.Input>();
    expectTypeOf<typeof plain>().not.toExtend<RouterService.Any>();
  });

  it('a make that requires a service is rejected by Router.from', () => {
    expectTypeOf<typeof NeedsDb>().not.toExtend<Router.Input>();
    expectTypeOf<typeof NeedsDb>().not.toExtend<RouterService.Any>();
    expectTypeOf<typeof MayFail>().not.toExtend<Router.Input>();
    // @ts-expect-error -- make requires Database
    // oxlint-disable-next-line effecttsgo/missing-effect-context -- deliberately wrong: `make` requires Database (the @ts-expect-error case)
    Router.from(NeedsDb);
    // @ts-expect-error -- make requires Database
    // oxlint-disable-next-line effecttsgo/missing-effect-context -- deliberately wrong: `make` requires Database (the @ts-expect-error case)
    Router.fromService(NeedsDb);
    // @ts-expect-error -- make requires Database
    // oxlint-disable-next-line effecttsgo/missing-effect-context -- deliberately wrong: `make` requires Database (the @ts-expect-error case)
    Router.make({ db: NeedsDb });
    // @ts-expect-error -- make may fail
    Router.from(MayFail);
  });

  it('a service with no make is not a router input', () => {
    class Plain extends Context.Service<Plain, { readonly n: number }>()('Plain') {}
    expectTypeOf<typeof Plain>().not.toExtend<Router.Input>();
    // @ts-expect-error -- not a router service
    Router.from(Plain);
  });

  it('Router.make resolves nested services to ordinary routers', () => {
    const router = Router.make({ health: query({ success: Schema.String }), admin: AdminRouter });
    expectTypeOf(router.record.admin).toEqualTypeOf<Router.Of<typeof AdminRouter>>();
    expectTypeOf<Router.Paths<typeof router>>().toEqualTypeOf<'health' | 'admin.x'>();
    expectTypeOf<inferRouterOutputs<typeof router>['admin']['x']>().toEqualTypeOf<number>();

    const deep = Router.make({ ns: { admin: AdminRouter } });
    expectTypeOf(deep.record.ns.admin).toEqualTypeOf<Router.Of<typeof AdminRouter>>();
    expectTypeOf<Router.Paths<typeof deep>>().toEqualTypeOf<'ns.admin.x'>();

    const withMw = router.middleware(LogMiddleware);
    expectTypeOf<Router.Paths<typeof withMw>>().toEqualTypeOf<'health' | 'admin.x'>();
  });

  it("a service's make may nest routers and services", () => {
    class Outer extends Context.Service<Outer>()('Outer', {
      make: Effect.succeed({ admin: AdminRouter, legacy: plain, deep: { admin: AdminRouter } }),
    }) {}
    expectTypeOf<Router.Paths<typeof Outer>>().toEqualTypeOf<
      'admin.x' | 'legacy.health' | 'legacy.post.byId' | 'legacy.post.create' | 'deep.admin.x'
    >();
    expectTypeOf(Router.fromService(Outer).record.admin).toEqualTypeOf<
      Router.Of<typeof AdminRouter>
    >();
    expectTypeOf<inferRouterInputs<typeof Outer>['deep']['admin']['x']>().toEqualTypeOf<void>();
  });

  it('type helpers resolve services in a raw record type', () => {
    type Raw = {
      readonly admin: typeof AdminRouter;
      readonly ns: { readonly admin: typeof AdminRouter };
    };
    expectTypeOf<Router.Paths<Raw>>().toEqualTypeOf<'admin.x' | 'ns.admin.x'>();
    expectTypeOf<inferRouterOutputs<Raw>['ns']['admin']['x']>().toEqualTypeOf<number>();
  });

  it('records without services keep their exact type', () => {
    const record = { health: query({ success: Schema.String }) };
    expectTypeOf(Router.make(record)).toEqualTypeOf<Router<typeof record>>();
  });

  it('generic code over Router.Shape keeps Router<Rec>', () => {
    const record = { health: query({ success: Schema.String }), ns: { other: plain } };
    expectTypeOf(makeGeneric(record)).toEqualTypeOf<Router<typeof record>>();
    expectTypeOf(Router.make(record)).toEqualTypeOf(makeGeneric(record));
  });

  it('serviceValue is typed as the service shape (nested services stay classes)', () => {
    class Outer extends Context.Service<Outer>()('Outer', {
      make: Effect.succeed({ admin: AdminRouter, ping: query({ success: Schema.String }) }),
    }) {}
    expectTypeOf(Router.serviceValue(Outer)).toEqualTypeOf<Context.Service.Shape<typeof Outer>>();
    expectTypeOf(Router.serviceValue(Outer).admin).toEqualTypeOf<typeof AdminRouter>();
    // @ts-expect-error -- make requires Database
    // oxlint-disable-next-line effecttsgo/missing-effect-context -- deliberately wrong: `make` requires Database (the @ts-expect-error case)
    Router.serviceValue(NeedsDb);
  });

  it('isService narrows to RouterService.Any', () => {
    const u: unknown = AppRouter;
    if (Router.isService(u)) {
      expectTypeOf(u).toEqualTypeOf<RouterService.Any>();
      expectTypeOf(Router.from(u)).toExtend<Router.Any>();
    }
  });

  it('generic code can normalise a Router.Input to Router.Any', () => {
    expectTypeOf(normalise(AppRouter)).toEqualTypeOf<readonly [typeof AppRouter, Router.Any]>();
  });
});
