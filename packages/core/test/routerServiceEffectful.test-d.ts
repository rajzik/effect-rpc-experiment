import { Context, Effect, Schema } from 'effect';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import { Procedure, Router } from '../src/index.js';
import type { RouterService } from '../src/index.js';

class AppConfig extends Context.Service<AppConfig, { readonly prefix: string }>()('AppConfig') {}

class Database extends Context.Service<
  Database,
  { readonly title: (id: number) => Effect.Effect<string> }
>()('Database') {}

class ConfigError extends Schema.TaggedError<ConfigError>()('ConfigError', {}) {}

class PostRouter extends Context.Service<PostRouter>()('PostRouter', {
  make: Effect.gen(function* () {
    const db = yield* Database;
    return {
      byId: Procedure.input({ id: Schema.Finite })
        .output(Schema.String)
        .query(({ id }) => db.title(id)),
    };
  }),
}) {}

class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.gen(function* () {
    const cfg = yield* AppConfig;
    if (cfg.prefix === '') return yield* new ConfigError();
    return {
      health: Procedure.output(Schema.String).query(() => Effect.succeed(cfg.prefix)),
      post: PostRouter,
    };
  }),
}) {}

class PureRouter extends Context.Service<PureRouter>()('PureRouter', {
  make: Effect.succeed({ ping: Procedure.output(Schema.String).query(() => Effect.succeed('p')) }),
}) {}

describe('effectful router services (types)', () => {
  it('an effectful service is RouterService.Effectful and sync APIs reject it', () => {
    expectTypeOf<typeof AppRouter>().toExtend<RouterService.Effectful>();
    expectTypeOf<typeof AppRouter>().not.toExtend<RouterService.Any>();
    expectTypeOf<typeof AppRouter>().not.toExtend<Router.Input>();
    expectTypeOf<typeof PostRouter>().toExtend<RouterService.Effectful>();
    // @ts-expect-error -- PostRouter's make requires Database
    // oxlint-disable-next-line effecttsgo/missing-effect-context -- deliberately wrong: `make` requires Database (the @ts-expect-error case)
    Router.make({ post: PostRouter });
    // @ts-expect-error -- AppRouter's make requires AppConfig and may fail
    // oxlint-disable-next-line effecttsgo/missing-effect-context -- deliberately wrong: `make` requires AppConfig (the @ts-expect-error case)
    Router.from(AppRouter);
  });

  it('resolves the paths of nested effectful services', () => {
    expectTypeOf<Router.Paths<typeof AppRouter>>().toEqualTypeOf<'health' | 'post.byId'>();
    expectTypeOf<Router.Paths<Router.Of<typeof AppRouter>>>().toEqualTypeOf<
      'health' | 'post.byId'
    >();
    expectTypeOf<Router.Record<typeof AppRouter>['post']>().toEqualTypeOf<
      Router.Of<typeof PostRouter>
    >();
  });

  it('collects the error and services of every make', () => {
    expectTypeOf<RouterService.MakeError<typeof AppRouter>>().toEqualTypeOf<ConfigError>();
    expectTypeOf<RouterService.MakeServices<typeof AppRouter>>().toEqualTypeOf<
      AppConfig | Database
    >();
  });

  it('buildService carries the router, the value and every make error and service', () => {
    expectTypeOf(Router.buildService(AppRouter)).toEqualTypeOf<
      Effect.Effect<
        {
          readonly router: Router.Of<typeof AppRouter>;
          readonly value: Context.Service.Shape<typeof AppRouter>;
        },
        ConfigError,
        AppConfig | Database
      >
    >();
    expectTypeOf(Router.buildService(PureRouter)).toEqualTypeOf<
      Effect.Effect<
        {
          readonly router: Router.Of<typeof PureRouter>;
          readonly value: Context.Service.Shape<typeof PureRouter>;
        }
        // E and R default to never: no error, no services
      >
    >();
  });

  it('a pure service makes with no error and no services', () => {
    expectTypeOf<RouterService.MakeError<typeof PureRouter>>().toEqualTypeOf<never>();
    expectTypeOf<RouterService.MakeServices<typeof PureRouter>>().toEqualTypeOf<never>();
    expectTypeOf<typeof PureRouter>().toExtend<RouterService.Any>();
    expectTypeOf<typeof PureRouter>().toExtend<RouterService.Effectful>();
  });
});
