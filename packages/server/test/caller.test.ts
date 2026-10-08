import { Effect, Exit, Fiber, Layer, Schema, Stream } from 'effect';
import { query, Router, RpcDefect, RpcInterrupted } from '@effect-trpc/core';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { createCaller, Handlers } from '../src/index.js';
import type { Caller } from '../src/index.js';
import {
  appRouter,
  createdAt,
  Forbidden,
  getCause,
  makeServer,
  NotFound,
  rejection,
  Unauthorized,
  User,
} from './fixtures.js';
import type { AppRouter, Probe } from './fixtures.js';

let caller: Caller<AppRouter>;
let probe: Probe;

beforeEach(() => {
  const server = makeServer();
  probe = server.probe;
  caller = createCaller(appRouter, { handlers: server.layer });
});

afterEach(async () => {
  await caller.dispose();
});

describe('createCaller — Effect API', () => {
  it('returns Effects of class instances', async () => {
    const user = await Effect.runPromise(caller.user.byId({ id: 'ada' }));
    expect(user).toBeInstanceOf(User);
    expect(user.greet()).toBe('Hello, Ada!');
    expect(user.createdAt).toEqual(createdAt);
  });

  it('fails with the typed error instance', async () => {
    const error = await Effect.runPromise(Effect.flip(caller.user.byId({ id: 'root' })));
    expect(error).toBeInstanceOf(Forbidden);
    expect(error._tag === 'Forbidden' ? error.reason : error.id).toBe('root is private');
  });

  it('dies (no typed error) when the handler dies', async () => {
    const exit = await Effect.runPromiseExit(caller.debug.die());
    expect(Exit.hasDies(exit)).toBe(true);
  });

  it('returns Streams for subscriptions', async () => {
    const users = await Effect.runPromise(Stream.runCollect(caller.user.list({ count: 2 })));
    expect(users.map((u) => u.name)).toEqual(['User 1', 'User 2']);
    expect(users[0]).toBeInstanceOf(User);
  });

  it('interrupting the Effect interrupts the handler', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(caller.debug.hang());
        yield* Effect.sleep('20 millis');
        yield* Fiber.interrupt(fiber);
      }),
    );
    await expect(probe.hangInterrupted).resolves.toBeUndefined();
  });

  it('calls procedures of merged routers and deep paths', async () => {
    const extra = Router.make({ deep: { er: { path: query({ success: Schema.String }) } } });
    const merged = Router.merge(appRouter, extra);
    const layer = Layer.mergeAll(
      makeServer().layer,
      Handlers.make(extra, { deep: { er: { path: () => Effect.succeed('deep') } } }),
    );
    const mergedCaller = createCaller(merged, { handlers: layer });
    try {
      expect(await mergedCaller.$promise.deep.er.path()).toBe('deep');
      expect(await mergedCaller.$promise.health()).toBe('ok');
    } finally {
      await mergedCaller.dispose();
    }
  });
});

describe('createCaller — Promise API', () => {
  it('resolves with instances', async () => {
    const user = await caller.$promise.user.create({ name: 'Grace' });
    expect(user).toBeInstanceOf(User);
    expect(user.id).toBe('grace');
  });

  it('rejects with the typed error instance', async () => {
    const error = await rejection(caller.$promise.user.byId({ id: 'ghost' }));
    expect(error).toBeInstanceOf(NotFound);
    expect(error).toMatchObject({ _tag: 'NotFound', id: 'ghost' });
  });

  it('rejects with RpcDefect when the handler dies', async () => {
    const error = await rejection(caller.$promise.debug.die());
    expect(error).toBeInstanceOf(RpcDefect);
    expect(error).toMatchObject({ message: 'boom' });
  });

  it('a defect does not break later calls', async () => {
    await rejection(caller.$promise.debug.die());
    expect(await caller.$promise.health()).toBe('ok');
  });

  it('rejects with RpcInterrupted on abort and interrupts the handler', async () => {
    const controller = new AbortController();
    const pending = caller.$promise.debug.hang(undefined, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    const error = await rejection(pending);
    expect(error).toBeInstanceOf(RpcInterrupted);
    await probe.hangInterrupted;
  });

  it('rejects immediately for an already aborted signal', async () => {
    const error = await rejection(
      caller.$promise.health(undefined, { signal: AbortSignal.abort() }),
    );
    expect(error).toBeInstanceOf(RpcInterrupted);
  });

  it('returns async iterables for subscriptions', async () => {
    const names: Array<string> = [];
    for await (const user of caller.$promise.user.list({ count: 3 })) {
      expect(user).toBeInstanceOf(User);
      names.push(user.name);
    }
    expect(names).toEqual(['User 1', 'User 2', 'User 3']);
  });

  it('breaking out of a subscription finalizes the server stream', async () => {
    const seen: Array<number> = [];
    for await (const n of caller.$promise.debug.infinite()) {
      seen.push(n);
      if (seen.length === 3) break;
    }
    expect(seen).toEqual([0, 1, 2]);
    await probe.infiniteFinalized;
  });

  it('aborting a subscription throws RpcInterrupted and finalizes the stream', async () => {
    const controller = new AbortController();
    const seen: Array<number> = [];
    const error = await rejection(
      (async () => {
        for await (const n of caller.$promise.debug.infinite(undefined, {
          signal: controller.signal,
        })) {
          seen.push(n);
          if (seen.length === 2) controller.abort();
        }
      })(),
    );
    expect(error).toBeInstanceOf(RpcInterrupted);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    await probe.infiniteFinalized;
  });
});

describe('createCaller — middleware and headers', () => {
  it('passes per-call headers to middleware, which provides CurrentUser', async () => {
    const me = await caller.$promise.user.me(undefined, { headers: { 'x-user': 'ada' } });
    expect(me.name).toBe('ada');
    expect(probe.events).toEqual(['trace:user.me', 'auth:ada', 'me:ada']);
  });

  it('a missing header fails with the typed middleware error', async () => {
    const error = await rejection(caller.$promise.user.me());
    expect(error).toBeInstanceOf(Unauthorized);
    const exit = await Effect.runPromiseExit(caller.user.me());
    expect(getCause(exit).reasons[0]).toMatchObject({
      _tag: 'Fail',
      error: { _tag: 'Unauthorized' },
    });
  });

  it('passes headers to the handler context', async () => {
    expect(
      await caller.$promise.debug.headers(undefined, { headers: { 'x-trace': 'abc' } }),
    ).toEqual({
      trace: 'abc',
    });
    expect(await Effect.runPromise(caller.debug.headers())).toEqual({ trace: null });
  });
});

describe('createCaller — proxy', () => {
  it('throws for unknown paths', () => {
    const untyped = caller as unknown as {
      readonly user: { readonly nope: () => unknown };
      readonly $promise: { readonly user: () => unknown };
    };
    expect(() => untyped.user.nope()).toThrow('Unknown procedure "user.nope"');
    expect(() => untyped.$promise.user()).toThrow('Unknown procedure "user"');
  });

  it('is not thenable and exposes the router', () => {
    expect((caller as unknown as { then?: unknown }).then).toBeUndefined();
    expect(caller.$router).toBe(appRouter);
  });

  it('dispose() releases the handler layer', async () => {
    expect(await caller.$promise.health()).toBe('ok');
    await caller.dispose();
    await probe.released;
  });

  it('dispose() interrupts in-flight calls; later calls are interrupted, not hung', async () => {
    const pending = rejection(caller.$promise.debug.hang());
    await new Promise((resolve) => setTimeout(resolve, 20));
    await caller.dispose();
    expect(await pending).toBeInstanceOf(RpcInterrupted);
    await expect(probe.hangInterrupted).resolves.toBeUndefined();

    expect(await rejection(caller.$promise.health())).toBeInstanceOf(RpcInterrupted);
    const exit = await Effect.runPromiseExit(caller.health());
    expect(Exit.hasInterrupts(exit)).toBe(true);
    const stream = rejection(
      (async () => {
        for await (const _ of caller.$promise.user.list({ count: 1 })) {
          // unreachable
        }
      })(),
    );
    expect(await stream).toBeInstanceOf(RpcInterrupted);
  });

  it('surfaces handler layer build failures as defects', async () => {
    const router = Router.make({ ping: query({ success: Schema.String }) });
    const broken = createCaller(router, {
      handlers: Handlers.make(router, Effect.die(new Error('cannot build'))),
    });
    try {
      const error = await rejection(broken.$promise.ping());
      expect(error).toBeInstanceOf(RpcDefect);
    } finally {
      await broken.dispose();
    }
  });
});
