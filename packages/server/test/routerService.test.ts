import { Cause, Context, Effect, Exit, Layer, Schema, Stream } from 'effect';
import { FetchHttpClient, HttpRouter, HttpServer } from 'effect/http';
import { RpcClient, RpcSerialization } from 'effect/rpc';
import { NodeHttpServer } from '@effect/platform-node';
import { Procedure, query, Router } from '@effect-trpc/core';
import { describe, expect, it } from 'vite-plus/test';
import { createCaller, Handlers, layerHttp, toWebHandler } from '../src/index.js';
import { runServer } from '../src/node.js';
import { Auth, AuthLive, CurrentUser, Trace, TraceLive, Unauthorized } from './fixtures.js';
import {
  AppRouter,
  Database,
  DatabaseLive,
  LegacyRouter,
  makeRuns,
  Post,
  PostNotFound,
  postCreatedAt,
} from './service-fixtures.js';

const appRouter = Router.from(AppRouter);

/** Builds `layer` and returns the message of the defect it dies with. */
const buildDefect = async <A, E>(layer: Layer.Layer<A, E>): Promise<string> => {
  const exit = await Effect.runPromiseExit(Effect.scoped(Layer.build(layer)));
  if (!Exit.isFailure(exit) || !Cause.hasDies(exit.cause)) throw new Error('expected a defect');
  const defect = Cause.squash(exit.cause);
  return defect instanceof Error ? defect.message : String(defect);
};

const ServerLive = Layer.mergeAll(Handlers.fromService(AppRouter), AuthLive()).pipe(
  Layer.provide(DatabaseLive),
);

describe('Handlers.fromService', () => {
  it('serves a service router end to end through createCaller', async () => {
    await using caller = createCaller(appRouter, { handlers: ServerLive });
    const post = await caller.$promise.post.byId({ id: 1 });
    expect(post).toBeInstanceOf(Post);
    expect(post.headline()).toBe('#1 Hello');
    expect(post.createdAt).toEqual(postCreatedAt);

    const error = await caller.$promise.post.byId({ id: 7 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PostNotFound);

    expect(await caller.$promise.health()).toBe('ok');
    const titles = await Effect.runPromise(Stream.runCollect(caller.post.titles()));
    expect(titles).toEqual(['first', 'second']);
  });

  it('runs middleware: provided services reach the handler, middleware errors are typed', async () => {
    await using caller = createCaller(appRouter, { handlers: ServerLive });
    expect(await caller.$promise.me(undefined, { headers: { 'x-user': 'ada' } })).toBe('ada');
    expect(await caller.$promise.whoami(undefined, { headers: { 'x-user': 'bob' } })).toBe(
      'I am bob',
    );
    const error = await caller.$promise.me().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Unauthorized);
  });

  it('serves a service router end to end through toWebHandler over HTTP', async () => {
    await using web = await toWebHandler(appRouter, { handlers: ServerLive });
    const fetch: typeof globalThis.fetch = (input, init) => web.handler(new Request(input, init));
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const client = yield* RpcClient.make(appRouter.group);
        const post = yield* client['post.byId']({ id: 1 });
        const missing = yield* Effect.flip(client['post.byId']({ id: 7 }));
        const titles = yield* Stream.runCollect(client['post.titles']());
        return { post, missing, titles };
      }).pipe(
        Effect.scoped,
        Effect.provide(
          RpcClient.layerProtocolHttp({ url: 'http://localhost/rpc' }).pipe(
            Layer.provide([
              FetchHttpClient.layer.pipe(
                Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fetch)),
              ),
              RpcSerialization.layerNdjson,
            ]),
          ),
        ),
      ),
    );
    if (!Exit.isSuccess(exit)) throw new Error(`call failed: ${String(exit.cause)}`);
    expect(exit.value.post).toBeInstanceOf(Post);
    expect(exit.value.post.headline()).toBe('#1 Hello');
    expect(exit.value.missing).toBeInstanceOf(PostNotFound);
    expect(exit.value.titles).toEqual(['first', 'second']);
  });

  it('provides the service: yield* Svc returns the procedures record', async () => {
    const procedures = await Effect.runPromise(
      Effect.provide(AppRouter, Handlers.fromService(AppRouter).pipe(Layer.provide(DatabaseLive))),
    );
    // `appRouter` built AppRouter synchronously: the layer reuses that router and record.
    expect(procedures).toBe(appRouter.record);
    expect(procedures.post.byId).toBe(appRouter.record.post.byId);
    expect(Procedure.hasHandler(procedures.post.byId)).toBe(true);
    expect(makeRuns.count).toBe(1); // every layer build in this file reused it
  });

  it('provides the raw make record: a nested router service stays the class', async () => {
    let runs = 0;
    class AdminRouter extends Context.Service<AdminRouter>()('NestedAdminRouter', {
      make: Effect.succeed({ x: Procedure.output(Schema.Finite).query(() => Effect.succeed(1)) }),
    }) {}
    class OuterRouter extends Context.Service<OuterRouter>()('NestedOuterRouter', {
      make: Effect.sync(() => {
        runs++;
        return { ping: Procedure.query(() => Effect.void), admin: AdminRouter };
      }),
    }) {}
    const router = Router.from(OuterRouter);
    const procedures = await Effect.runPromise(
      Effect.provide(OuterRouter, Handlers.fromService(OuterRouter)),
    );
    // Exactly what `make` produced, as `Context.Service.Shape<typeof OuterRouter>` types it.
    expect(procedures).toBe(Router.serviceValue(OuterRouter));
    expect(procedures.admin).toBe(AdminRouter);
    expect(Effect.isEffect(procedures.admin.make)).toBe(true);
    expect(procedures.ping).toBe(router.record.ping);
    // The router still resolves the nested service.
    expect(router.record.admin).toBe(Router.from(AdminRouter));
    expect(runs).toBe(1);
  });

  it('reuses a router service built synchronously; otherwise runs make per layer build', async () => {
    let runs = 0;
    class Counted extends Context.Service<Counted>()('CountedRouter', {
      make: Effect.sync(() => {
        const run = ++runs;
        return { run: Procedure.output(Schema.Finite).query(() => Effect.succeed(run)) };
      }),
    }) {}
    const layer = Handlers.fromService(Counted);
    expect(runs).toBe(0);
    // Not built synchronously yet: the layer build runs make.
    await Effect.runPromise(Effect.provide(Counted, layer));
    expect(runs).toBe(1);
    // A sync API builds (and memoizes) it; later layer builds reuse that router and record.
    const router = Router.from(Counted);
    expect(runs).toBe(2);
    const procedures = await Effect.runPromise(Effect.provide(Counted, layer));
    expect(procedures).toBe(Router.serviceValue(Counted));
    expect(procedures.run).toBe(router.record.run);
    await using caller = createCaller(Counted, { handlers: layer });
    expect(await caller.$promise.run()).toBe(2); // the handler of the memoized make run
    expect(runs).toBe(2);
  });

  it('fromService rejects procedures without handlers', async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- forces the compile error away to prove the runtime check
    const forced = LegacyRouter as unknown as typeof AppRouter;
    expect(await buildDefect(Handlers.fromService(forced).pipe(Layer.provide(DatabaseLive)))).toBe(
      'Handlers.fromService: the router service "LegacyRouter" has procedures without a handler: "user.byId", "health" (defined with query/mutation/subscription({...})). Build them with Procedure (e.g. Procedure.input(...).query(handler)), or implement the router with Handlers.make',
    );
  });

  it('serves a service whose make is asynchronous', async () => {
    class AsyncRouter extends Context.Service<AsyncRouter>()('AsyncRouter', {
      make: Effect.sleep('1 millis').pipe(Effect.as({ ok: Procedure.query(() => Effect.void) })),
    }) {}
    const procedures = await Effect.runPromise(
      Effect.provide(AsyncRouter, Handlers.fromService(AsyncRouter)),
    );
    expect(Procedure.hasHandler(procedures.ok)).toBe(true);
  });
});

describe('router-level middleware in a router service', () => {
  it('a make returning a router is a clear runtime error', async () => {
    class Wrapped extends Context.Service<Wrapped>()('WrappedRouter', {
      make: Effect.succeed(
        Router.make({ ok: Procedure.query(() => Effect.void) }).middleware(Trace),
      ),
    }) {}
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- forces the compile error away to prove the runtime check
    const forced = Wrapped as unknown as typeof AppRouter;
    expect(await buildDefect(Handlers.fromService(forced).pipe(Layer.provide(DatabaseLive)))).toBe(
      'Cannot build a router from the router service "WrappedRouter": make must succeed with a record of procedures, not a router (return the record, or nest the router under a key)',
    );
  });

  it('serves a router with middleware nested in the make record', async () => {
    class Guarded extends Context.Service<Guarded>()('GuardedRouter', {
      make: Effect.succeed({
        health: Procedure.output(Schema.String).query(() => Effect.succeed('ok')),
        admin: Router.make({
          me: Procedure.output(Schema.String).query(() =>
            Effect.map(CurrentUser, (user) => `admin ${user.name}`),
          ),
        }).middleware(Auth),
      }),
    }) {}
    await using caller = createCaller(Guarded, {
      handlers: Layer.mergeAll(Handlers.fromService(Guarded), AuthLive()),
    });
    expect(await caller.$promise.health()).toBe('ok');
    expect(await caller.$promise.admin.me(undefined, { headers: { 'x-user': 'ada' } })).toBe(
      'admin ada',
    );
    const error = await caller.$promise.admin.me().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Unauthorized);
  });
});

describe('Handlers.fromProcedures', () => {
  it('serves a plain router of builder procedures', async () => {
    const router = Router.make({
      post: {
        byId: Procedure.input({ id: Schema.Finite })
          .output(Post)
          .error(PostNotFound)
          .query(({ id }) => Effect.flatMap(Database, (db) => db.findPost(id))),
      },
    });
    await using caller = createCaller(router, {
      handlers: Handlers.fromProcedures(router).pipe(Layer.provide(DatabaseLive)),
    });
    expect(await caller.$promise.post.byId({ id: 1 })).toBeInstanceOf(Post);
    expect(await caller.$promise.post.byId({ id: 2 }).catch((e: unknown) => e)).toBeInstanceOf(
      PostNotFound,
    );
  });

  it('middleware keeps handlers and removes provided services from requirements', async () => {
    const events: Array<string> = [];
    const guarded = appRouter.middleware(Trace);
    await using caller = createCaller(guarded, {
      handlers: Layer.mergeAll(
        Handlers.fromProcedures(guarded),
        AuthLive(events),
        TraceLive(events),
      ).pipe(Layer.provide(DatabaseLive)),
    });
    expect(await caller.$promise.me(undefined, { headers: { 'x-user': 'ada' } })).toBe('ada');
    expect((await caller.$promise.post.byId({ id: 1 })).title).toBe('Hello');
    expect(events).toEqual(['auth:ada', 'trace:me', 'trace:post.byId']);
  });

  it('serves services nested in a router', async () => {
    const router = Router.make({ app: AppRouter, ping: Procedure.query(() => Effect.void) });
    await using caller = createCaller(router, {
      handlers: Layer.mergeAll(Handlers.fromProcedures(router), AuthLive()).pipe(
        Layer.provide(DatabaseLive),
      ),
    });
    expect((await caller.$promise.app.post.byId({ id: 1 })).title).toBe('Hello');
    expect(await caller.$promise.ping()).toBeUndefined();
  });

  it('fromProcedures rejects procedures without handlers', () => {
    const legacy = Router.make({
      ok: Procedure.query(() => Effect.void),
      nested: { old: query({ success: Schema.String }) },
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- forces the compile error away to prove the runtime check
    const forced = legacy as unknown as Router<{ readonly ok: typeof legacy.record.ok }>;
    expect(() => Handlers.fromProcedures(forced)).toThrow(
      'Handlers.fromProcedures: the router has procedures without a handler: "nested.old" (defined with query/mutation/subscription({...})). Build them with Procedure (e.g. Procedure.input(...).query(handler)), or implement the router with Handlers.make',
    );
  });
});

/** Calls the service router over HTTP with an effect/rpc client (instances + typed errors). */
const callOverHttp = (url: string, fetch?: typeof globalThis.fetch) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(appRouter.group);
      const post = yield* client['post.byId']({ id: 1 });
      const missing = yield* Effect.flip(client['post.byId']({ id: 7 }));
      const titles = yield* Stream.runCollect(client['post.titles']());
      return { post, missing, titles };
    }).pipe(
      Effect.scoped,
      Effect.provide(
        RpcClient.layerProtocolHttp({ url }).pipe(
          Layer.provide([
            fetch === undefined
              ? FetchHttpClient.layer
              : FetchHttpClient.layer.pipe(
                  Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fetch)),
                ),
            RpcSerialization.layerNdjson,
          ]),
        ),
      ),
    ),
  );

/** What the HTTP calls decoded to: instances (with methods and Dates) and the typed error. */
const decoded = (result: Awaited<ReturnType<typeof callOverHttp>>) => ({
  post: result.post instanceof Post,
  headline: result.post.headline(),
  createdAt: result.post.createdAt.toISOString(),
  missing: result.missing instanceof PostNotFound,
  titles: result.titles,
});
const expected = {
  post: true,
  headline: '#1 Hello',
  createdAt: postCreatedAt.toISOString(),
  missing: true,
  titles: ['first', 'second'],
};

describe('server adapters accept the router service class', () => {
  it('createCaller', async () => {
    await using caller = createCaller(AppRouter, { handlers: ServerLive });
    expect(caller.$router).toBe(appRouter);
    const post = await caller.$promise.post.byId({ id: 1 });
    expect(post).toBeInstanceOf(Post);
    expect(post.headline()).toBe('#1 Hello');
    expect(await caller.$promise.post.byId({ id: 7 }).catch((e: unknown) => e)).toBeInstanceOf(
      PostNotFound,
    );
    const missing = await Effect.runPromise(Effect.flip(caller.post.byId({ id: 7 })));
    expect(missing).toBeInstanceOf(PostNotFound);
  });

  it('toWebHandler', async () => {
    await using web = await toWebHandler(AppRouter, { handlers: ServerLive });
    expect(
      decoded(
        await callOverHttp('http://localhost/rpc', (input, init) =>
          web.handler(new Request(input, init)),
        ),
      ),
    ).toEqual(expected);
  });

  it('layerHttp', async () => {
    const app = HttpRouter.serve(layerHttp(AppRouter, { handlers: ServerLive }), {
      disableLogger: true,
      disableListenLog: true,
    });
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const address = HttpServer.formatAddress((yield* HttpServer.HttpServer).address);
        return yield* Effect.promise(() => callOverHttp(`${address}/rpc`));
      }).pipe(Effect.provide(app.pipe(Layer.provideMerge(NodeHttpServer.layerTest)))),
    );
    expect(decoded(result)).toEqual(expected);
  });

  it('runServer', async () => {
    await using server = await runServer(AppRouter, { handlers: ServerLive, port: 0 });
    expect(decoded(await callOverHttp(server.url))).toEqual(expected);
  });

  it('Handlers.make implements a service of plain definitions', async () => {
    const handlers = Handlers.make(LegacyRouter, {
      ok: () => Effect.void,
      user: { byId: () => Effect.succeed('ada') },
      health: () => Effect.succeed('ok' as const),
    });
    await using caller = createCaller(LegacyRouter, { handlers });
    expect(await caller.$promise.user.byId()).toBe('ada');
    expect(await caller.$promise.health()).toBe('ok');
  });
});
