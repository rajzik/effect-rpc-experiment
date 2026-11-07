import { Context, Effect, Exit, Layer, Schema } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { RpcClient, RpcSerialization } from 'effect/rpc';
import { Procedure, query, Router } from '@effect-trpc/core';
import { describe, expect, it } from 'vite-plus/test';
import { createCaller, Handlers, toWebHandler } from '../src/index.js';
import type { WebHandler } from '../src/index.js';

class AppConfig extends Context.Service<AppConfig, { readonly prefix: string }>()('AppConfig') {}

class Database extends Context.Service<
  Database,
  { readonly title: (id: number) => Effect.Effect<string> }
>()('Database') {}

class ConfigError extends Schema.TaggedError<ConfigError>()('ConfigError', {}) {}

/** Counts evaluations of `AppRouter.make` (not memoized: once per layer build). */
const makeRuns = { count: 0 };

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
    makeRuns.count++;
    const cfg = yield* AppConfig;
    if (cfg.prefix === '') return yield* new ConfigError();
    return {
      health: Procedure.output(Schema.String).query(() => Effect.succeed(cfg.prefix)),
      post: PostRouter,
    };
  }),
}) {}

/** The schema-only router clients and `toWebHandler` take (normally `router.client.gen.ts`). */
const contract = Router.make({
  health: query({ success: Schema.String }),
  post: { byId: query({ payload: { id: Schema.Finite }, success: Schema.String }) },
});

const AppConfigLive = (prefix: string) => Layer.succeed(AppConfig)({ prefix });
const DatabaseLive = Layer.succeed(Database)({ title: (id) => Effect.succeed(`post ${id}`) });

const handlersLive = (prefix: string) =>
  Handlers.fromService(AppRouter).pipe(Layer.provide([AppConfigLive(prefix), DatabaseLive]));

/** Calls the contract's procedures over HTTP through `web`. */
const callOverHttp = (web: WebHandler) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(contract.group);
      const health = yield* client.health();
      const post = yield* client['post.byId']({ id: 1 });
      return { health, post };
    }).pipe(
      Effect.scoped,
      Effect.provide(
        RpcClient.layerProtocolHttp({ url: 'http://localhost/rpc' }).pipe(
          Layer.provide([
            FetchHttpClient.layer.pipe(
              Layer.provide(
                Layer.succeed(FetchHttpClient.Fetch)((input, init) =>
                  web.handler(new Request(input, init)),
                ),
              ),
            ),
            RpcSerialization.layerNdjson,
          ]),
        ),
      ),
    ),
  );

describe('Handlers.fromService with an effectful make', () => {
  it('serves end to end through toWebHandler(contract)', async () => {
    await using web = await toWebHandler(contract, { handlers: handlersLive('v1') });
    const exit = await callOverHttp(web);
    if (!Exit.isSuccess(exit)) throw new Error(`call failed: ${String(exit.cause)}`);
    expect(exit.value).toEqual({ health: 'v1', post: 'post 1' });
  });

  it('make runs per build', async () => {
    const before = makeRuns.count;
    await using first = await toWebHandler(contract, { handlers: handlersLive('a') });
    await using second = await toWebHandler(contract, { handlers: handlersLive('b') });
    expect(makeRuns.count - before).toBe(2);
    // Each build's router comes from its own make run, with its own services.
    const a = await callOverHttp(first);
    if (!Exit.isSuccess(a)) throw new Error(`call failed: ${String(a.cause)}`);
    const b = await callOverHttp(second);
    if (!Exit.isSuccess(b)) throw new Error(`call failed: ${String(b.cause)}`);
    expect(a.value.health).toBe('a');
    expect(b.value.health).toBe('b');
  });

  it('make failure fails the layer build with the typed error', async () => {
    const error = await Effect.runPromise(
      Effect.flip(Effect.scoped(Layer.build(handlersLive('')))),
    );
    expect(error).toBeInstanceOf(ConfigError);
  });

  it('yield* AppRouter returns the record make produced', async () => {
    const value = await Effect.runPromise(Effect.provide(AppRouter, handlersLive('v1')));
    expect(value.post).toBe(PostRouter);
    expect(Procedure.hasHandler(value.health)).toBe(true);
  });

  it('nested mix: pure services and routers inside an effectful make are served', async () => {
    class PureRouter extends Context.Service<PureRouter>()('MixPureRouter', {
      make: Effect.succeed({ x: Procedure.output(Schema.String).query(() => Effect.succeed('x')) }),
    }) {}
    class MixRouter extends Context.Service<MixRouter>()('MixRouter', {
      make: Effect.gen(function* () {
        const cfg = yield* AppConfig;
        return {
          a: { b: PureRouter },
          c: Router.make({
            d: Procedure.output(Schema.String).query(() => Effect.succeed(`d ${cfg.prefix}`)),
          }),
        };
      }),
    }) {}
    const mixContract = Router.make({
      a: { b: { x: query({ success: Schema.String }) } },
      c: { d: query({ success: Schema.String }) },
    });
    const { router } = await Effect.runPromise(
      Router.buildService(MixRouter).pipe(Effect.provideService(AppConfig, { prefix: 'v1' })),
    );
    expect([...router.procedures.keys()]).toEqual(['a.b.x', 'c.d']);
    await using caller = createCaller(mixContract, {
      handlers: Handlers.fromService(MixRouter).pipe(Layer.provide(AppConfigLive('v1'))),
    });
    expect(await caller.$promise.a.b.x()).toBe('x');
    expect(await caller.$promise.c.d()).toBe('d v1');
  });

  it('a scoped make: its finalizer runs when the server is disposed', async () => {
    const closed = { count: 0 };
    class Scoped extends Context.Service<Scoped>()('Scoped', {
      make: Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            closed.count++;
          }),
        );
        return { ping: Procedure.output(Schema.String).query(() => Effect.succeed('pong')) };
      }),
    }) {}
    const scopedContract = Router.make({ ping: query({ success: Schema.String }) });
    {
      await using caller = createCaller(scopedContract, { handlers: Handlers.fromService(Scoped) });
      expect(await caller.$promise.ping()).toBe('pong');
      expect(closed.count).toBe(0);
    }
    expect(closed.count).toBe(1);
  });
});
