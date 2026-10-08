import { Cause, Effect, Exit, Layer, Stream } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  createClient,
  Link,
  localLink,
  RpcDefect,
  RpcTransportError,
  type Client,
} from '../src/index.js';
import {
  alice,
  appRouter,
  Forbidden,
  makeHandlers,
  NotFound,
  Unauthorized,
  User,
  type AppRouter,
} from './fixtures.js';
import { drain, rejectionOf } from './helpers.js';

const clients: Array<Client<AppRouter>> = [];
const makeClient = (options: { readonly headers?: Record<string, string> } = {}) => {
  const client = createClient(appRouter, {
    link: localLink({ handlers: makeHandlers() }),
    ...options,
  });
  clients.push(client);
  return client;
};

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.dispose()));
});

describe('localLink: Promise client', () => {
  it('returns Schema.Class instances with methods and Date fields', async () => {
    const client = makeClient();
    const user = await client.user.byId({ id: '1' });
    expect(user).toBeInstanceOf(User);
    expect(user.greet()).toBe('Hello, Alice!');
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user).toEqual(alice());
  });

  it('rejects with the TaggedError instance of the procedure', async () => {
    const client = makeClient();
    const notFound = await rejectionOf(client.user.byId({ id: '7' }));
    expect(notFound).toBeInstanceOf(NotFound);
    expect(notFound).toMatchObject({ _tag: 'NotFound', id: '7' });
    const forbidden = await rejectionOf(client.user.byId({ id: 'secret' }));
    expect(forbidden).toBeInstanceOf(Forbidden);
    expect(forbidden).toMatchObject({ _tag: 'Forbidden', reason: 'private' });
  });

  it('rejects with RpcDefect when the handler dies, and keeps working afterwards', async () => {
    const client = makeClient();
    const defect = await rejectionOf(client.boom());
    expect(defect).toBeInstanceOf(RpcDefect);
    expect(defect).toMatchObject({ _tag: '@effect-trpc/RpcDefect', message: 'kaboom' });
    await expect(client.health()).resolves.toBe('ok');
  });

  it('calls void-payload queries and mutations with no arguments or undefined', async () => {
    const client = makeClient();
    await expect(client.health()).resolves.toBe('ok');
    await expect(client.user.reset()).resolves.toBe(0);
    await expect(client.user.reset(undefined)).resolves.toBe(0);
    const created = await client.user.create({ name: 'Bob' });
    expect(created).toBeInstanceOf(User);
    expect(created.greet()).toBe('Hello, Bob!');
  });

  it('exposes subscriptions as async iterables', async () => {
    const client = makeClient();
    const { values, error } = await drain(client.ticks({ n: 4 }));
    expect(values).toEqual([0, 1, 2, 3]);
    expect(error).toBeUndefined();
  });

  it('throws the typed error instance from an async iterable that fails mid-stream', async () => {
    const client = makeClient();
    const { values, error } = await drain(client.tickStream({ failAt: 2 }));
    expect(values).toEqual([0, 1]);
    expect(error).toBeInstanceOf(NotFound);
  });

  it('runs calls concurrently over one link', async () => {
    const client = makeClient();
    const results = await Promise.all([
      client.user.byId({ id: '1' }),
      client.health(),
      rejectionOf(client.user.byId({ id: '3' })),
    ]);
    expect(results[0]).toBeInstanceOf(User);
    expect(results[1]).toBe('ok');
    expect(results[2]).toBeInstanceOf(NotFound);
  });
});

describe('localLink: Effect client ($effect)', () => {
  it('succeeds with instances and fails with typed errors instead of throwing', async () => {
    const client = makeClient();
    const user = await Effect.runPromise(client.$effect.user.byId({ id: '1' }));
    expect(user).toBeInstanceOf(User);
    const error = await Effect.runPromise(Effect.flip(client.$effect.user.byId({ id: '9' })));
    expect(error).toBeInstanceOf(NotFound);
    const handled = await Effect.runPromise(
      client.$effect.user.byId({ id: 'secret' }).pipe(
        Effect.catchTag('Forbidden', (e) => Effect.succeed(`forbidden: ${e.reason}`)),
        Effect.catchTag('NotFound', () => Effect.succeed('missing')),
      ),
    );
    expect(handled).toBe('forbidden: private');
  });

  it('keeps defects as defects', async () => {
    const client = makeClient();
    const exit = await Effect.runPromiseExit(client.$effect.boom());
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
  });

  it('exposes subscriptions as Streams', async () => {
    const client = makeClient();
    const ticks = await Effect.runPromise(Stream.runCollect(client.$effect.ticks({ n: 3 })));
    expect(ticks).toEqual([0, 1, 2]);
    const failed = await Effect.runPromise(
      Effect.flip(Stream.runCollect(client.$effect.tickStream({ failAt: 1 }))),
    );
    expect(failed).toBeInstanceOf(NotFound);
  });

  it('is lazy: effects can be built before and run many times', async () => {
    const client = makeClient();
    const health = client.$effect.health();
    expect(await Effect.runPromise(Effect.all([health, health, health]))).toEqual([
      'ok',
      'ok',
      'ok',
    ]);
  });
});

describe('localLink: headers and middleware', () => {
  it('rejects a middleware-protected procedure without the header', async () => {
    const client = makeClient();
    expect(await rejectionOf(client.whoami())).toBeInstanceOf(Unauthorized);
  });

  it('sends client-level, withHeaders and per-call headers (later wins)', async () => {
    const client = makeClient({ headers: { 'x-user': 'base', 'x-client': '1' } });
    await expect(client.whoami()).resolves.toBe('base');
    const scoped = client.withHeaders({ 'x-user': 'scoped', 'x-scoped': '1' });
    await expect(scoped.whoami()).resolves.toBe('scoped');
    await expect(scoped.whoami(undefined, { headers: { 'x-user': 'call' } })).resolves.toBe('call');
    await expect(scoped.headers(undefined, { headers: { 'x-call': '1' } })).resolves.toEqual({
      'x-user': 'scoped',
      'x-client': '1',
      'x-scoped': '1',
      'x-call': '1',
    });
    // `withHeaders` does not mutate the original client
    await expect(client.headers()).resolves.toEqual({ 'x-user': 'base', 'x-client': '1' });
    await expect(
      Effect.runPromise(client.$effect.whoami(undefined, { headers: { 'x-user': 'fx' } })),
    ).resolves.toBe('fx');
  });

  it('evaluates a headers function once per call', async () => {
    let n = 0;
    const client = createClient(appRouter, {
      link: localLink({ handlers: makeHandlers() }),
      headers: async () => ({ 'x-user': `user-${++n}` }),
    });
    clients.push(client);
    await expect(client.whoami()).resolves.toBe('user-1');
    await expect(client.whoami()).resolves.toBe('user-2');
  });

  it('fails the call with RpcTransportError when the headers function throws', async () => {
    const client = createClient(appRouter, {
      link: localLink({ handlers: makeHandlers() }),
      headers: () => {
        throw new Error('no token');
      },
    });
    clients.push(client);
    const error = await rejectionOf(client.health());
    expect(error).toBeInstanceOf(RpcTransportError);
    expect(error).toMatchObject({ message: 'The client headers() function threw' });
  });
});

describe('createClient: proxy and lifecycle', () => {
  it('throws a clear error for unknown paths and namespaces', () => {
    const client = makeClient() as unknown as Record<string, Record<string, () => unknown>>;
    expect(() => client.user?.nope?.()).toThrow('Unknown procedure "user.nope"');
    expect(() => (client.user as unknown as () => unknown)()).toThrow(
      '"user" is a router namespace, not a procedure',
    );
  });

  it('is not thenable and returns stable proxies', async () => {
    const client = makeClient();
    expect(await Promise.resolve(client)).toBe(client);
    expect(await Promise.resolve(client.user)).toBe(client.user);
    expect(client.user.byId).toBe(client.user.byId);
    expect(client.$router).toBe(appRouter);
    expect((client as unknown as Record<string, unknown>).toJSON).toBeUndefined();
  });

  it('rejects routers with reserved top-level keys', async () => {
    const { Router, query } = await import('@effect-trpc/core');
    const router = Router.make({ dispose: query() });
    expect(() =>
      createClient(router, {
        link: localLink({ handlers: router.group.toLayer({ dispose: () => Effect.void }) }),
      }),
    ).toThrow('top-level key "dispose" is reserved');
  });

  it('builds the link lazily, once, and releases it on dispose', async () => {
    const acquired = vi.fn<() => void>();
    const released = vi.fn<() => void>();
    const base = localLink({ handlers: makeHandlers() });
    const link = Link.make((group) =>
      Effect.acquireRelease(Effect.sync(acquired), () => Effect.sync(released)).pipe(
        Effect.andThen(base.makeClient(group)),
      ),
    );
    const client = createClient(appRouter, { link });
    expect(acquired).not.toHaveBeenCalled();
    await Promise.all([client.health(), client.health(), client.withHeaders({}).health()]);
    await client.user.byId({ id: '1' });
    expect(acquired).toHaveBeenCalledTimes(1);
    await client.dispose();
    await client.dispose();
    expect(released).toHaveBeenCalledTimes(1);
  });

  it('fails calls after dispose with RpcTransportError', async () => {
    const client = makeClient();
    await client.health();
    await client[Symbol.asyncDispose]();
    expect(await rejectionOf(client.health())).toBeInstanceOf(RpcTransportError);
    const fxError = await Effect.runPromise(Effect.flip(client.$effect.health()));
    expect(fxError).toMatchObject({ message: 'The client has been disposed' });
    expect((await drain(client.ticks({ n: 1 }))).error).toBeInstanceOf(RpcTransportError);
  });

  it('dies with a layer error turned into a defect', async () => {
    const client = createClient(appRouter, {
      link: localLink({
        handlers: Layer.merge(makeHandlers(), Layer.effectDiscard(Effect.fail('bad config'))),
      }),
    });
    clients.push(client);
    expect(await rejectionOf(client.health())).toBeInstanceOf(RpcDefect);
  });
});
