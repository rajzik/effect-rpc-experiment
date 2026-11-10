import { Context, Effect, Layer, Schema } from 'effect';
import type { Rpc } from 'effect/rpc';
import { Procedure, query, Router } from '@rpc-effect/core';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import { Handlers, toWebHandler } from '../src/index.js';
import { Auth, CurrentUser } from './fixtures.js';

class AppConfig extends Context.Service<AppConfig, { readonly prefix: string }>()('AppConfig') {}

class Database extends Context.Service<
  Database,
  { readonly title: (id: number) => Effect.Effect<string> }
>()('Database') {}

class Clock extends Context.Service<Clock, { readonly now: Effect.Effect<number> }>()('Clock') {}

class ConfigError extends Schema.TaggedError<ConfigError>()('ConfigError', {}) {}

class DbError extends Schema.TaggedError<DbError>()('DbError', {}) {}

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

const contract = Router.make({
  health: query({ success: Schema.String }),
  post: { byId: query({ payload: { id: Schema.Finite }, success: Schema.String }) },
});

describe('Handlers.fromService types (effectful make)', () => {
  it('infers the make error and services, nested makes included', () => {
    expectTypeOf(Handlers.fromService(AppRouter)).toEqualTypeOf<
      Layer.Layer<
        Rpc.Handler<'health'> | Rpc.Handler<'post.byId'> | AppRouter,
        ConfigError,
        AppConfig | Database
      >
    >();
  });

  it('a pure service keeps the layer type it had', () => {
    class Pure extends Context.Service<Pure>()('Pure', {
      make: Effect.succeed({
        one: Procedure.output(Schema.Finite).query(() => Effect.as(Clock, 1)),
      }),
    }) {}
    expectTypeOf(Handlers.fromService(Pure)).toEqualTypeOf<
      Layer.Layer<Rpc.Handler<'one'> | Pure, never, Clock>
    >();
  });

  it('a nested make that fails contributes its error', () => {
    class Failing extends Context.Service<Failing>()('Failing', {
      make: Effect.fail(new DbError()).pipe(
        Effect.as({ x: Procedure.output(Schema.Finite).query(() => Effect.succeed(1)) }),
      ),
    }) {}
    class Outer extends Context.Service<Outer>()('Outer', {
      make: Effect.succeed({ failing: Failing }),
    }) {}
    expectTypeOf(Handlers.fromService(Outer)).toEqualTypeOf<
      Layer.Layer<Rpc.Handler<'failing.x'> | Outer, DbError>
    >();
  });

  it('an effectful service nested in a plain record contributes its tags and services', () => {
    class Outer extends Context.Service<Outer>()('NestedOuter', {
      make: Effect.succeed({ admin: { post: PostRouter } }),
    }) {}
    expectTypeOf(Handlers.fromService(Outer)).toEqualTypeOf<
      Layer.Layer<Rpc.Handler<'admin.post.byId'> | Outer, never, Database>
    >();
  });

  it('handler-read services stay requirements; middleware-provided services do not', () => {
    class Guarded extends Context.Service<Guarded>()('Guarded', {
      make: Effect.gen(function* () {
        const cfg = yield* AppConfig;
        return {
          now: Procedure.output(Schema.Finite).query(() => Effect.flatMap(Clock, (c) => c.now)),
          me: Procedure.output(Schema.String)
            .middleware(Auth)
            .query(() => Effect.map(CurrentUser, (u) => `${cfg.prefix}${u.name}`)),
        };
      }),
    }) {}
    expectTypeOf(Handlers.fromService(Guarded)).toEqualTypeOf<
      Layer.Layer<Rpc.Handler<'now'> | Rpc.Handler<'me'> | Guarded, never, AppConfig | Clock>
    >();
  });

  it('procedures without a handler are still a compile error', () => {
    class Legacy extends Context.Service<Legacy>()('Legacy', {
      make: Effect.gen(function* () {
        yield* AppConfig;
        return { old: query({ success: Schema.String }) };
      }),
    }) {}
    expectTypeOf<Handlers.WithoutHandler<Router.Of<typeof Legacy>>>().toEqualTypeOf<'old'>();
    // @ts-expect-error - "old" was defined with query({...}): no handler
    Handlers.fromService(Legacy);
  });

  it('sync APIs take the contract, not the class', () => {
    const live = Handlers.fromService(AppRouter).pipe(
      Layer.provide([
        Layer.succeed(AppConfig)({ prefix: 'v1' }),
        Layer.succeed(Database)({ title: (id) => Effect.succeed(`post ${id}`) }),
      ]),
    );
    expectTypeOf(live).toEqualTypeOf<
      Layer.Layer<Rpc.Handler<'health'> | Rpc.Handler<'post.byId'> | AppRouter, ConfigError>
    >();
    void toWebHandler(contract, { handlers: live });
    // @ts-expect-error - make reads services: give toWebHandler the contract
    void toWebHandler(AppRouter, { handlers: live }); // oxlint-disable-line effecttsgo/missing-effect-context -- the service is passed on purpose to prove the compile error
  });

  it('a scoped make does not leak Scope into the layer', () => {
    class Scoped extends Context.Service<Scoped>()('Scoped', {
      make: Effect.gen(function* () {
        yield* Effect.addFinalizer(() => Effect.void);
        return { ping: Procedure.output(Schema.String).query(() => Effect.succeed('pong')) };
      }),
    }) {}
    expectTypeOf(Handlers.fromService(Scoped)).toEqualTypeOf<
      Layer.Layer<Rpc.Handler<'ping'> | Scoped>
    >();
  });
});
