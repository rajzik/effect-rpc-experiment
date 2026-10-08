import { Context, Effect, Exit, Layer, Schema, Stream } from 'effect';
import type { Scope } from 'effect';
import { RpcTest } from 'effect/rpc';
import { causeToClientError, query, Router, RpcDefect } from '@effect-trpc/core';
import { describe, expect, it } from 'vite-plus/test';
import { Handlers } from '../src/index.js';
import { ada, appRouter, getCause, makeServer, NotFound, Unauthorized, User } from './fixtures.js';

const run = <A, E>(
  effect: Effect.Effect<A, E, Handlers.Requirements<typeof appRouter> | Scope.Scope>,
): Promise<A> => {
  const { layer } = makeServer();
  return Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(layer)));
};

describe('Handlers.make', () => {
  it('produces a layer accepted by RpcTest.makeClient (instances, not copies)', async () => {
    const result = await run(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(appRouter.group);
        const user = yield* client['user.byId']({ id: 'ada' });
        const health = yield* client.health();
        return { user, health };
      }),
    );
    expect(result.health).toBe('ok');
    expect(result.user).toBeInstanceOf(User);
    expect(result.user.greet()).toBe('Hello, Ada!');
    expect(result.user.createdAt).toBeInstanceOf(Date);
  });

  it('fails with the typed error instance', async () => {
    const exit = await run(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(appRouter.group);
        return yield* Effect.exit(client['user.byId']({ id: 'nobody' }));
      }),
    );
    const error = causeToClientError(getCause(exit));
    expect(error).toBeInstanceOf(NotFound);
    expect(error).toMatchObject({ _tag: 'NotFound', id: 'nobody' });
  });

  it('passes the handler context: headers and requestId', async () => {
    const result = await run(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(appRouter.group);
        const withHeader = yield* client['debug.headers'](undefined, {
          headers: { 'x-trace': 'abc' },
        });
        const without = yield* client['debug.headers']();
        const id1 = yield* client['debug.requestId']();
        const id2 = yield* client['debug.requestId']();
        return { withHeader, without, id1, id2 };
      }),
    );
    expect(result.withHeader).toEqual({ trace: 'abc' });
    expect(result.without).toEqual({ trace: null });
    expect(result.id1).toMatch(/^\d+$/);
    expect(result.id1).not.toBe(result.id2);
  });

  it('runs stream handlers for subscriptions', async () => {
    const users = await run(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(appRouter.group);
        return yield* Stream.runCollect(client['user.list']({ count: 3 }));
      }),
    );
    expect(users.map((u) => u.id)).toEqual(['u1', 'u2', 'u3']);
    expect(users.every((u) => u instanceof User)).toBe(true);
  });

  it('accepts an Effect that builds the record from services', async () => {
    class Greeting extends Context.Service<Greeting, { readonly word: string }>()('Greeting') {}
    const router = Router.make({
      greet: query({ payload: { name: Schema.String }, success: Schema.String }),
    });
    const HandlersLive = Handlers.make(
      router,
      Effect.gen(function* () {
        const { word } = yield* Greeting;
        return Handlers.of(router, { greet: ({ name }) => Effect.succeed(`${word}, ${name}`) });
      }),
    ).pipe(Layer.provide(Layer.succeed(Greeting)({ word: 'Hi' })));
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(router.group);
        return yield* client.greet({ name: 'Ada' });
      }).pipe(Effect.scoped, Effect.provide(HandlersLive)),
    );
    expect(result).toBe('Hi, Ada');
  });

  it('lets handlers depend on services provided by middleware', async () => {
    const result = await run(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(appRouter.group);
        return yield* client['user.me'](undefined, { headers: { 'x-user': 'grace' } });
      }),
    );
    expect(result).toBeInstanceOf(User);
    expect(result.name).toBe('grace');
  });

  it('throws for a missing handler at runtime (untyped callers)', () => {
    const router = Router.make({ a: query({ success: Schema.String }), b: { c: query({}) } });
    const nested: unknown = { a: () => Effect.succeed('a'), b: {} };
    expect(() => Handlers.make(router, nested as Handlers.From<typeof router>)).toThrow(
      'Missing handler for procedure "b.c"',
    );
  });

  it('fails the layer when an Effect-built record misses a handler', async () => {
    const router = Router.make({ a: query({ success: Schema.String }) });
    const incomplete = {} as unknown as { readonly a: () => Effect.Effect<string> };
    const layer = Handlers.make(router, Effect.succeed(incomplete));
    const exit = await Effect.runPromiseExit(Layer.build(layer).pipe(Effect.scoped));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(causeToClientError(getCause(exit))).toBeInstanceOf(RpcDefect);
  });
});

describe('Handlers.flat / Handlers.of', () => {
  it('implements a router from tag-keyed handlers', async () => {
    const router = Router.make({ user: { byId: appRouter.record.user.byId } });
    const layer = Handlers.flat(router, {
      'user.byId': ({ id }) =>
        id === 'ada' ? Effect.succeed(ada()) : Effect.fail(new NotFound({ id })),
    });
    const user = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(router.group);
        return yield* client['user.byId']({ id: 'ada' });
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );
    expect(user.greet()).toBe('Hello, Ada!');
  });

  it('Handlers.of returns the record unchanged', () => {
    const router = Router.make({ ping: query({ success: Schema.String }) });
    const record = { ping: () => Effect.succeed('pong') };
    expect(Handlers.of(router, record)).toBe(record);
  });

  it('releases resources acquired by the handler layer', async () => {
    const { layer, probe } = makeServer();
    await Effect.runPromise(Layer.build(layer).pipe(Effect.scoped));
    await expect(probe.released).resolves.toBeUndefined();
  });
});

describe('middleware context', () => {
  it('runs middleware in order and provides CurrentUser', async () => {
    const { layer, probe } = makeServer();
    const name = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(appRouter.group);
        const me = yield* client['user.me'](undefined, { headers: { 'x-user': 'ada' } });
        return me.name;
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );
    expect(name).toBe('ada');
    expect(probe.events).toEqual(['trace:user.me', 'auth:ada', 'me:ada']);
  });

  it('short-circuits with the middleware error before the handler runs', async () => {
    const { layer, probe } = makeServer();
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(appRouter.group);
        return yield* client['user.me']();
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );
    expect(causeToClientError(getCause(exit))).toBeInstanceOf(Unauthorized);
    expect(probe.events).toEqual(['trace:user.me', 'auth:-']);
  });
});
