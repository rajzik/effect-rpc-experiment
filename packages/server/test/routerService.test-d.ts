import { Context, Effect, Layer, Schema, Stream } from 'effect';
import type { Scope } from 'effect';
import type { HttpRouter, HttpServerError } from 'effect/http';
import type { Rpc } from 'effect/rpc';
import { Procedure, query, Router, subscription } from '@effect-trpc/core';
import type { RouterService } from '@effect-trpc/core';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import { createCaller, Handlers, layerHttp, toHttpLayer, toWebHandler } from '../src/index.js';
import type { Caller, WebHandler } from '../src/index.js';
import { runServer, serve } from '../src/node.js';
import type { RunningServer } from '../src/node.js';
import { Auth, AuthLive, CurrentUser, Trace, Unauthorized } from './fixtures.js';
import {
  AppRouter,
  Database,
  DatabaseLive,
  LegacyRouter,
  Post,
  PostNotFound,
} from './service-fixtures.js';

class Clock extends Context.Service<Clock, { readonly ticks: Stream.Stream<number> }>()('Clock') {}

/** `AppRouter` written with plain definitions: what `typeof AppRouter` must infer like. */
const plainRouter = Router.make({
  health: query({ success: Schema.Literal('ok') }),
  post: {
    byId: query({ payload: { id: Schema.Finite }, success: Post, error: PostNotFound }),
    titles: subscription({ success: Schema.String }),
  },
  me: query({ success: Schema.String }).middleware(Auth),
  whoami: query({ success: Schema.String }).middleware(Auth),
});
declare const plainHandlers: Layer.Layer<Caller.Requirements<typeof plainRouter>>;
void Unauthorized;

type AppProvides =
  | Rpc.Handler<'health'>
  | Rpc.Handler<'post.byId'>
  | Rpc.Handler<'post.titles'>
  | Rpc.Handler<'me'>
  | Rpc.Handler<'whoami'>;

describe('Handlers.fromService types', () => {
  it('requirements are inferred', () => {
    const layer = Handlers.fromService(AppRouter);
    // Handlers + the service itself; `Database` is read by handlers; `CurrentUser` (provided by
    // `Auth`) and `Scope` are not requirements.
    expectTypeOf(layer).toEqualTypeOf<Layer.Layer<AppProvides | AppRouter, never, Database>>();
    expectTypeOf<Handlers.Provides<Router.Of<typeof AppRouter>>>().toEqualTypeOf<AppProvides>();
    expectTypeOf<
      Handlers.ProcedureServices<Router.Of<typeof AppRouter>>
    >().toEqualTypeOf<Database>();
  });

  it('infers requirements from a Stream handler', () => {
    class Ticks extends Context.Service<Ticks>()('Ticks', {
      make: Effect.succeed({
        ticks: Procedure.output(Schema.Finite).subscription(() =>
          Stream.unwrap(Effect.map(Clock, (clock) => clock.ticks)),
        ),
        scoped: Procedure.output(Schema.Finite).subscription(() =>
          Stream.unwrap(
            Effect.gen(function* () {
              const clock = yield* Clock;
              yield* Effect.addFinalizer(() => Effect.void);
              return clock.ticks;
            }),
          ),
        ),
      }),
    }) {}
    expectTypeOf(Handlers.fromService(Ticks)).toEqualTypeOf<
      Layer.Layer<Rpc.Handler<'ticks'> | Rpc.Handler<'scoped'> | Ticks, never, Clock>
    >();
  });

  it('excludes Scope from an Effect handler that adds a finalizer', () => {
    // `Stream.unwrap` already strips `Scope`, so prove the exclusion on an Effect (query) handler.
    class Scoped extends Context.Service<Scoped>()('Scoped', {
      make: Effect.succeed({
        scoped: Procedure.output(Schema.Finite).query(() =>
          Effect.gen(function* () {
            yield* Clock;
            yield* Effect.addFinalizer(() => Effect.void);
            return 1;
          }),
        ),
      }),
    }) {}
    expectTypeOf(Router.from(Scoped).record.scoped.handler).returns.toEqualTypeOf<
      Effect.Effect<number, never, Clock | Scope.Scope>
    >();
    expectTypeOf(Handlers.fromService(Scoped)).toEqualTypeOf<
      Layer.Layer<Rpc.Handler<'scoped'> | Scoped, never, Clock>
    >();
    expectTypeOf(Handlers.fromProcedures(Router.from(Scoped))).toEqualTypeOf<
      Layer.Layer<Rpc.Handler<'scoped'>, never, Clock>
    >();
    expectTypeOf<Handlers.ProcedureServices<Router.Of<typeof Scoped>>>().toEqualTypeOf<Clock>();
  });

  it('a service whose handlers need nothing has no requirements', () => {
    class Pure extends Context.Service<Pure>()('Pure', {
      make: Effect.succeed({ one: Procedure.output(Schema.Finite).query(() => Effect.succeed(1)) }),
    }) {}
    expectTypeOf(Handlers.fromService(Pure)).toEqualTypeOf<
      Layer.Layer<Rpc.Handler<'one'> | Pure>
    >();
  });

  it('fromService rejects procedures without handlers', () => {
    expectTypeOf<Handlers.WithoutHandler<Router.Of<typeof LegacyRouter>>>().toEqualTypeOf<
      'user.byId' | 'health'
    >();
    expectTypeOf<Handlers.WithoutHandler<Router.Of<typeof AppRouter>>>().toBeNever();
    // The compile error: TypeScript reports this property (one per path) as missing.
    expectTypeOf<keyof Handlers.RequireHandlers<Router.Of<typeof LegacyRouter>>>().toEqualTypeOf<
      | "procedure 'user.byId' has no handler (defined with query/mutation/subscription({...})): build it with Procedure (e.g. Procedure.input(...).query(handler)), or implement the router with Handlers.make"
      | "procedure 'health' has no handler (defined with query/mutation/subscription({...})): build it with Procedure (e.g. Procedure.input(...).query(handler)), or implement the router with Handlers.make"
    >();
    expectTypeOf<Handlers.RequireHandlers<Router.Of<typeof AppRouter>>>().toBeUnknown();
    // @ts-expect-error - "user.byId" and "health" were defined with query({...}): no handler
    Handlers.fromService(LegacyRouter);
  });

  it('fromService accepts a service whose make needs services', () => {
    class NeedsDb extends Context.Service<NeedsDb>()('NeedsDb', {
      make: Effect.gen(function* () {
        yield* Database;
        return { ok: Procedure.query(() => Effect.void) };
      }),
    }) {}
    expectTypeOf(NeedsDb).not.toExtend<RouterService.Any>();
    // make's requirements become the layer's (see routerServiceEffectful.test-d.ts).
    expectTypeOf(Handlers.fromService(NeedsDb)).toEqualTypeOf<
      Layer.Layer<Rpc.Handler<'ok'> | NeedsDb, never, Database>
    >();
  });

  it('the layer serves the service router through createCaller and toWebHandler', () => {
    const live = Layer.mergeAll(Handlers.fromService(AppRouter), AuthLive()).pipe(
      Layer.provide(DatabaseLive),
    );
    expectTypeOf(live).toExtend<Layer.Layer<Handlers.Requirements<Router.Of<typeof AppRouter>>>>();
    createCaller(Router.from(AppRouter), { handlers: live });
    void toWebHandler(Router.from(AppRouter), { handlers: live });
    // Without the Auth implementation the layer does not satisfy the router.
    createCaller(Router.from(AppRouter), {
      // @ts-expect-error - the Auth middleware implementation is missing
      handlers: Handlers.fromService(AppRouter).pipe(Layer.provide(DatabaseLive)),
    });
  });

  it('provides the service: yield* Svc is the procedures record', () => {
    const program = Effect.gen(function* () {
      const procedures = yield* AppRouter;
      expectTypeOf(procedures).toEqualTypeOf<Context.Service.Shape<typeof AppRouter>>();
      return procedures.post.byId;
    });
    expectTypeOf(program).toEqualTypeOf<
      Effect.Effect<Context.Service.Shape<typeof AppRouter>['post']['byId'], never, AppRouter>
    >();
    // The layer provides `AppRouter`, so it satisfies the program's requirement.
    expectTypeOf(Handlers.fromService(AppRouter)).toExtend<
      Layer.Layer<AppRouter, never, Database>
    >();
  });
});

describe('router-level middleware in a router service (types)', () => {
  it('a make returning a router (Router.make(...).middleware(M)) is rejected', () => {
    class Wrapped extends Context.Service<Wrapped>()('Wrapped', {
      make: Effect.succeed(
        Router.make({
          me: Procedure.output(Schema.String).query(() => Effect.map(CurrentUser, (u) => u.name)),
        }).middleware(Auth),
      ),
    }) {}
    expectTypeOf(Wrapped).not.toExtend<RouterService.Any>();
    // @ts-expect-error - make must succeed with a record, not a router
    Handlers.fromService(Wrapped);
  });

  it('a router with middleware nested in the make record keeps handlers and provided services', () => {
    class Guarded extends Context.Service<Guarded>()('Guarded', {
      make: Effect.succeed({
        health: Procedure.output(Schema.String).query(() => Effect.succeed('ok')),
        admin: Router.make({
          me: Procedure.output(Schema.String).query(() => Effect.map(CurrentUser, (u) => u.name)),
          db: Procedure.input({ id: Schema.Finite })
            .output(Post)
            .error(PostNotFound)
            .query(({ id }) => Effect.flatMap(Database, (db) => db.findPost(id))),
        }).middleware(Auth),
      }),
    }) {}
    expectTypeOf(Guarded).toExtend<RouterService.Any>();
    expectTypeOf<Router.Paths<typeof Guarded>>().toEqualTypeOf<
      'health' | 'admin.me' | 'admin.db'
    >();
    // `CurrentUser` is provided by `Auth`; `Database` stays a requirement.
    expectTypeOf(Handlers.fromService(Guarded)).toEqualTypeOf<
      Layer.Layer<
        Rpc.Handler<'health'> | Rpc.Handler<'admin.me'> | Rpc.Handler<'admin.db'> | Guarded,
        never,
        Database
      >
    >();
  });
});

describe('Handlers.fromProcedures types', () => {
  it('requirements are inferred for a plain router of builder procedures', () => {
    const router = Router.make({
      post: {
        byId: Procedure.input({ id: Schema.Finite })
          .output(Post)
          .error(PostNotFound)
          .query(({ id }) => Effect.flatMap(Database, (db) => db.findPost(id))),
      },
      ticks: Procedure.output(Schema.Finite).subscription(() =>
        Stream.unwrap(Effect.map(Clock, (clock) => clock.ticks)),
      ),
    });
    expectTypeOf(Handlers.fromProcedures(router)).toEqualTypeOf<
      Layer.Layer<Rpc.Handler<'post.byId'> | Rpc.Handler<'ticks'>, never, Database | Clock>
    >();
  });

  it('middleware keeps handlers and removes provided services from requirements', () => {
    const guarded = Router.from(AppRouter).middleware(Trace);
    expectTypeOf(Handlers.fromProcedures(guarded)).toEqualTypeOf<
      Layer.Layer<AppProvides, never, Database>
    >();
    const authed = Router.make({
      me: Procedure.output(Schema.String).query(() => Effect.map(CurrentUser, (user) => user.name)),
    }).middleware(Auth);
    expectTypeOf(Handlers.fromProcedures(authed)).toEqualTypeOf<Layer.Layer<Rpc.Handler<'me'>>>();
    // Without the middleware, CurrentUser is a requirement.
    const open = Router.make({
      me: Procedure.output(Schema.String).query(() => Effect.map(CurrentUser, (user) => user.name)),
    });
    expectTypeOf(Handlers.fromProcedures(open)).toEqualTypeOf<
      Layer.Layer<Rpc.Handler<'me'>, never, CurrentUser>
    >();
  });

  it('a service nested in a router contributes its handlers and requirements', () => {
    const router = Router.make({ app: AppRouter, extra: Procedure.query(() => Effect.void) });
    expectTypeOf(Handlers.fromProcedures(router)).toEqualTypeOf<
      Layer.Layer<
        | Rpc.Handler<'app.health'>
        | Rpc.Handler<'app.post.byId'>
        | Rpc.Handler<'app.post.titles'>
        | Rpc.Handler<'app.me'>
        | Rpc.Handler<'app.whoami'>
        | Rpc.Handler<'extra'>,
        never,
        Database
      >
    >();
  });

  it('fromProcedures rejects procedures without handlers', () => {
    const legacy = Router.make({
      ok: Procedure.query(() => Effect.void),
      nested: { old: query({ success: Schema.String }) },
    });
    expectTypeOf<Handlers.WithoutHandler<typeof legacy>>().toEqualTypeOf<'nested.old'>();
    // @ts-expect-error - "nested.old" was defined with query({...}): no handler
    Handlers.fromProcedures(legacy);
    // @ts-expect-error - a nested legacy service is rejected too
    Handlers.fromProcedures(Router.make({ legacy: LegacyRouter }));
  });
});

/** Generic code over `Router.Any` keeps `Caller<R>` (the first overload). */
const forRouter = <R extends Router.Any>(
  router: R,
  handlers: Layer.Layer<Caller.Requirements<R>>,
): Caller<R> => createCaller(router, { handlers });

describe('server adapters accept the router service class (types)', () => {
  const live = Layer.mergeAll(Handlers.fromService(AppRouter), AuthLive()).pipe(
    Layer.provide(DatabaseLive),
  );
  type AppRouterOf = Router.Of<typeof AppRouter>;

  it('createCaller infers the caller of Router.Of<typeof Svc>, like the Router.make equivalent', () => {
    const caller = createCaller(AppRouter, { handlers: live });
    expectTypeOf(caller).toEqualTypeOf<Caller<AppRouterOf>>();
    expectTypeOf(caller.$router).toEqualTypeOf<AppRouterOf>();
    const plainCaller = createCaller(plainRouter, { handlers: plainHandlers });
    expectTypeOf(caller.post.byId).toEqualTypeOf<typeof plainCaller.post.byId>();
    expectTypeOf(caller.$promise.post.byId).toEqualTypeOf<typeof plainCaller.$promise.post.byId>();
    expectTypeOf(caller.post.titles).toEqualTypeOf<typeof plainCaller.post.titles>();
    expectTypeOf(caller.me).toEqualTypeOf<typeof plainCaller.me>();
    expectTypeOf(caller.post.byId).returns.toEqualTypeOf<Effect.Effect<Post, PostNotFound>>();
  });

  it('the handler layer is still checked against the service router', () => {
    expectTypeOf(live).toExtend<Layer.Layer<Caller.Requirements<AppRouterOf>>>();
    createCaller(AppRouter, {
      // @ts-expect-error - the Auth middleware implementation is missing
      handlers: Handlers.fromService(AppRouter).pipe(Layer.provide(DatabaseLive)),
    });
    void toWebHandler(AppRouter, {
      // @ts-expect-error - the Auth middleware implementation is missing
      handlers: Handlers.fromService(AppRouter).pipe(Layer.provide(DatabaseLive)),
    });
  });

  it('toWebHandler rejects a router service whose make needs services', () => {
    class NeedsDb extends Context.Service<NeedsDb>()('NeedsDb', {
      make: Effect.gen(function* () {
        yield* Database;
        return { ok: Procedure.query(() => Effect.void) };
      }),
    }) {}
    expectTypeOf(NeedsDb).not.toExtend<Router.Input>();
    // @ts-expect-error - make must be Effect<Record, never, never>: read services inside handlers
    void toWebHandler(NeedsDb, { handlers: live }); // oxlint-disable-line effecttsgo/missing-effect-context -- the service is passed on purpose to prove the compile error
  });

  it('toWebHandler, layerHttp, serve and runServer accept typeof Svc', () => {
    expectTypeOf(toWebHandler(AppRouter, { handlers: live })).toEqualTypeOf<Promise<WebHandler>>();
    expectTypeOf(layerHttp(AppRouter, { handlers: live })).toEqualTypeOf<
      Layer.Layer<never, never, HttpRouter.HttpRouter>
    >();
    expectTypeOf(layerHttp(AppRouter)).toEqualTypeOf(layerHttp(plainRouter));
    expectTypeOf(toHttpLayer(AppRouter, { handlers: live })).toEqualTypeOf<
      Layer.Layer<never, never, HttpRouter.HttpRouter>
    >();
    expectTypeOf(serve(AppRouter, { handlers: live, port: 0 })).toEqualTypeOf<
      Layer.Layer<never, HttpServerError.ServeError>
    >();
    expectTypeOf(runServer(AppRouter, { handlers: live, port: 0 })).toEqualTypeOf<
      Promise<RunningServer>
    >();
  });

  it('Handlers.make, flat and of type handlers from the service router', () => {
    const layer = Handlers.make(LegacyRouter, {
      ok: () => Effect.void,
      user: { byId: () => Effect.succeed('ada') },
      health: () => Effect.succeed('ok' as const),
    });
    expectTypeOf(layer).toEqualTypeOf<
      Layer.Layer<Handlers.Provides<Router.Of<typeof LegacyRouter>>>
    >();
    expectTypeOf(
      Handlers.flat(LegacyRouter, {
        ok: () => Effect.void,
        'user.byId': () => Effect.succeed('ada'),
        health: () => Effect.succeed('ok' as const),
      }),
    ).toEqualTypeOf(layer);
    const handlers = Handlers.of(LegacyRouter, {
      ok: () => Effect.void,
      user: { byId: () => Effect.succeed('ada') },
      health: () => Effect.succeed('ok' as const),
    });
    expectTypeOf(handlers.user.byId).returns.toEqualTypeOf<Effect.Effect<string>>();
    // @ts-expect-error - a missing handler is still a type error
    Handlers.make(LegacyRouter, { ok: () => Effect.void, health: () => Effect.succeed('ok') });
  });

  it('type queries on the instantiated Handlers.make compile', () => {
    // `ReturnType<typeof Handlers.make>` (uninstantiated) hits TS2589 because of the overloads:
    // instantiate it, or use `Handlers.Provides<R>` / `Handlers.Services<R, H>`.
    type H = Handlers.From<typeof plainRouter>;
    expectTypeOf<ReturnType<typeof Handlers.make<typeof plainRouter, H>>>().toEqualTypeOf<
      Layer.Layer<
        Handlers.Provides<typeof plainRouter>,
        never,
        Handlers.Services<typeof plainRouter, H>
      >
    >();
    expectTypeOf<Parameters<typeof Handlers.make<typeof plainRouter, H>>[0]>().toEqualTypeOf<
      typeof plainRouter
    >();
    expectTypeOf<
      ReturnType<typeof Handlers.make<AppRouterOf, Handlers.From<AppRouterOf>>>
    >().toEqualTypeOf<
      Layer.Layer<
        Handlers.Provides<AppRouterOf>,
        never,
        Handlers.Services<AppRouterOf, Handlers.From<AppRouterOf>>
      >
    >();
  });

  it('generic code keeps its types', () => {
    expectTypeOf(forRouter(plainRouter, plainHandlers)).toEqualTypeOf<Caller<typeof plainRouter>>();
  });
});
