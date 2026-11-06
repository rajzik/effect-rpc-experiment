import { Effect, Exit } from 'effect';
import { RpcDefect } from '@effect-trpc/core';
import { describe, expect, it } from 'vite-plus/test';
import {
  assertInstance,
  testCaller,
  testServerAndClient,
  testWebHandler,
  withTestServer,
} from '../src/index.js';
import { appRouter, createdAt, HandlersLive, NotFound, User } from './fixtures.js';
import { canConnect, rawRequestBody, readNdjson, rejectionOf } from './helpers.js';

describe('testServerAndClient', () => {
  it('serves the router on an ephemeral port with an absolute url', async () => {
    await using ctx = await testServerAndClient(appRouter, { handlers: HandlersLive });
    expect(ctx.port).toBeGreaterThan(0);
    expect(ctx.url).toBe(`http://localhost:${ctx.port}/rpc`);
    expect(ctx.effectClient).toBe(ctx.client.$effect);
  });

  it('returns Schema.Class instances with methods and Dates', async () => {
    await using ctx = await testServerAndClient(appRouter, { handlers: HandlersLive });
    const user = await ctx.client.user.byId({ id: '1' });
    assertInstance(user, User);
    expect(user.greet()).toBe('Hello, Ada!');
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.createdAt.getTime()).toBe(createdAt.getTime());
    expect(await ctx.client.user.create({ name: 'Grace' })).toMatchObject({ name: 'Grace' });
  });

  it('rejects with TaggedError instances', async () => {
    await using ctx = await testServerAndClient(appRouter, { handlers: HandlersLive });
    const error = await rejectionOf(ctx.client.user.byId({ id: 'ghost' }));
    assertInstance(error, NotFound);
    expect(error._tag).toBe('NotFound');
    expect(error.id).toBe('ghost');
  });

  it('surfaces defects as RpcDefect and keeps serving', async () => {
    await using ctx = await testServerAndClient(appRouter, { handlers: HandlersLive });
    expect(await rejectionOf(ctx.client.boom())).toBeInstanceOf(RpcDefect);
    expect(await ctx.client.health()).toBe('ok');
  });

  it('streams subscriptions', async () => {
    await using ctx = await testServerAndClient(appRouter, { handlers: HandlersLive });
    const users: Array<User> = [];
    for await (const user of ctx.client.user.list({ count: 3 })) users.push(user);
    expect(users.map((u) => u.id)).toEqual(['u1', 'u2', 'u3']);
    expect(users[2]).toBeInstanceOf(User);
  });

  it('exposes the Effect client', async () => {
    await using ctx = await testServerAndClient(appRouter, { handlers: HandlersLive });
    const user = await Effect.runPromise(ctx.effectClient.user.byId({ id: '2' }));
    expect(user).toBeInstanceOf(User);
    const exit = await Effect.runPromiseExit(ctx.effectClient.user.byId({ id: 'ghost' }));
    expect(Exit.isFailure(exit) && Exit.findErrorOption(exit)).toBeTruthy();
  });

  it('answers raw rpc requests through the fetch web handler', async () => {
    await using ctx = await testServerAndClient(appRouter, { handlers: HandlersLive });
    const response = await ctx.fetch(
      new Request(ctx.url, {
        method: 'POST',
        headers: { 'content-type': 'application/ndjson' },
        body: rawRequestBody('user.byId', { id: '7' }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await readNdjson(response)).toContainEqual(
      expect.objectContaining({
        _tag: 'Exit',
        requestId: '1',
        exit: {
          _tag: 'Success',
          value: { id: '7', name: 'Ada', createdAt: createdAt.toISOString() },
        },
      }),
    );
    // relative urls resolve against `ctx.url`
    const relative = await ctx.fetch('/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/ndjson' },
      body: rawRequestBody('health'),
    });
    expect(relative.status).toBe(200);
  });

  it('exposes an in-process caller', async () => {
    await using ctx = await testServerAndClient(appRouter, { handlers: HandlersLive });
    expect(await Effect.runPromise(ctx.caller.user.byId({ id: '3' }))).toBeInstanceOf(User);
    expect(await rejectionOf(ctx.caller.$promise.user.byId({ id: 'ghost' }))).toBeInstanceOf(
      NotFound,
    );
  });

  it('closes the port on dispose; a second dispose is a no-op', async () => {
    const ctx = await testServerAndClient(appRouter, { handlers: HandlersLive });
    expect(await ctx.client.health()).toBe('ok');
    expect(await canConnect(ctx.port)).toBe(true);
    await ctx.dispose();
    expect(await canConnect(ctx.port)).toBe(false);
    await expect(ctx.dispose()).resolves.toBeUndefined();
    await expect(ctx[Symbol.asyncDispose]()).resolves.toBeUndefined();
  });

  it('disposes at the end of an `await using` block', async () => {
    let port = 0;
    {
      await using ctx = await testServerAndClient(appRouter, { handlers: HandlersLive });
      port = ctx.port;
      expect(await ctx.client.health()).toBe('ok');
    }
    expect(await canConnect(port)).toBe(false);
  });

  it('honours a custom path', async () => {
    await using ctx = await testServerAndClient(appRouter, {
      handlers: HandlersLive,
      path: '/api/trpc',
    });
    expect(ctx.url).toBe(`http://localhost:${ctx.port}/api/trpc`);
    expect(await ctx.client.user.byId({ id: '1' })).toBeInstanceOf(User);
  });

  it('sends the client headers option', async () => {
    await using ctx = await testServerAndClient(appRouter, {
      handlers: HandlersLive,
      headers: { 'x-test': '1' },
    });
    expect(await ctx.client.health()).toBe('ok');
  });
});

describe.each(['json', 'ndjson'] as const)('serialization: %s', (serialization) => {
  it('preserves Schema.Class and TaggedError instances over HTTP', async () => {
    await using ctx = await testServerAndClient(appRouter, {
      handlers: HandlersLive,
      serialization,
    });
    const user = await ctx.client.user.byId({ id: '1' });
    assertInstance(user, User);
    expect(user.greet()).toBe('Hello, Ada!');
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(await rejectionOf(ctx.client.user.byId({ id: 'ghost' }))).toBeInstanceOf(NotFound);
  });

  it('preserves instances through the web handler client', async () => {
    await using web = await testWebHandler(appRouter, { handlers: HandlersLive, serialization });
    expect(await web.client.user.byId({ id: '1' })).toBeInstanceOf(User);
    expect(await rejectionOf(web.client.user.byId({ id: 'ghost' }))).toBeInstanceOf(NotFound);
  });
});

describe('withTestServer', () => {
  it('disposes after `use` resolves', async () => {
    const port = await withTestServer(appRouter, { handlers: HandlersLive }, async (ctx) => {
      expect(await ctx.client.health()).toBe('ok');
      return ctx.port;
    });
    expect(await canConnect(port)).toBe(false);
  });

  it('disposes after `use` rejects and rethrows', async () => {
    let port = 0;
    const error = await rejectionOf(
      withTestServer(appRouter, { handlers: HandlersLive }, async (ctx) => {
        port = ctx.port;
        await ctx.client.user.byId({ id: 'ghost' });
      }),
    );
    expect(error).toBeInstanceOf(NotFound);
    expect(await canConnect(port)).toBe(false);
  });
});

describe('testWebHandler', () => {
  it('serves a client over a custom fetch without opening a port', async () => {
    await using web = await testWebHandler(appRouter, { handlers: HandlersLive });
    expect(web.url).toBe('http://localhost/rpc');
    const user = await web.client.user.byId({ id: '1' });
    assertInstance(user, User);
    expect(user.greet()).toBe('Hello, Ada!');
    expect(await rejectionOf(web.client.boom())).toBeInstanceOf(RpcDefect);
    const users: Array<User> = [];
    for await (const u of web.client.user.list({ count: 2 })) users.push(u);
    expect(users).toHaveLength(2);
  });

  it('answers raw requests through fetch and handler', async () => {
    await using web = await testWebHandler(appRouter, { handlers: HandlersLive });
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/ndjson' },
      body: rawRequestBody('health'),
    };
    expect((await web.fetch('/rpc', init)).status).toBe(200);
    expect((await web.handler(new Request(web.url, init))).status).toBe(200);
    await web.dispose();
    await expect(web.dispose()).resolves.toBeUndefined();
  });
});

describe('testCaller', () => {
  it('calls procedures in-process with Effect and Promise APIs', async () => {
    await using caller = testCaller(appRouter, HandlersLive);
    expect(await Effect.runPromise(caller.user.byId({ id: '1' }))).toBeInstanceOf(User);
    expect(await rejectionOf(caller.$promise.user.byId({ id: 'ghost' }))).toBeInstanceOf(NotFound);
    expect(await rejectionOf(caller.$promise.boom())).toBeInstanceOf(RpcDefect);
  });
});

describe('assertInstance', () => {
  it('narrows matching instances and throws a descriptive TypeError otherwise', () => {
    const value: unknown = new NotFound({ id: 'x' });
    assertInstance(value, NotFound);
    expect(value.id).toBe('x');
    expect(() => assertInstance({}, User)).toThrow('expected an instance of User, got Object');
    expect(() => assertInstance(null, User)).toThrow('got null');
    expect(() => assertInstance(1, User, 'custom')).toThrow('custom');
  });
});
