import { Context, Effect, Layer, Schema, Stream } from 'effect';
import type { Rpc } from 'effect/rpc';
import { Procedure, query, Router } from '@effect-trpc/core';
import type { RouterService } from '@effect-trpc/core';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import { createCaller, Handlers, toWebHandler } from '../src/index.js';
import { Auth, AuthLive, CurrentUser, Trace } from './fixtures.js';
import {
  AppRouter,
  Database,
  DatabaseLive,
  LegacyRouter,
  Post,
  PostNotFound,
} from './service-fixtures.js';

class Clock extends Context.Service<Clock, { readonly ticks: Stream.Stream<number> }>()('Clock') {}

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

  it('fromService rejects a service whose make needs services', () => {
    class NeedsDb extends Context.Service<NeedsDb>()('NeedsDb', {
      make: Effect.gen(function* () {
        yield* Database;
        return { ok: Procedure.query(() => Effect.void) };
      }),
    }) {}
    expectTypeOf(NeedsDb).not.toExtend<RouterService.Any>();
    // @ts-expect-error - make must be Effect<Record, never, never>
    Handlers.fromService(NeedsDb);
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
