import type { Client } from '@effect-trpc/client';
import type { Router } from '@effect-trpc/core';
import type { Caller } from '@effect-trpc/server';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import { testCaller, testServerAndClient, testWebHandler, withTestServer } from '../src/index.js';
import type { TestServerAndClient, TestWebHandler } from '../src/index.js';
import { AppHandlers, AppRouter, plainRouter } from './service-fixtures.js';
import type { Post } from './service-fixtures.js';

type AppRouterOf = Router.Of<typeof AppRouter>;
declare const plainClient: Client<typeof plainRouter>;
declare const plainCaller: Caller<typeof plainRouter>;

describe('test-utils with a router service (types)', () => {
  it('testServerAndClient infers Router.Of<typeof Svc>, like the Router.make equivalent', async () => {
    const ctx = await testServerAndClient(AppRouter, { handlers: AppHandlers });
    expectTypeOf(ctx).toEqualTypeOf<TestServerAndClient<AppRouterOf>>();
    expectTypeOf(ctx.client.post.byId).toEqualTypeOf<typeof plainClient.post.byId>();
    expectTypeOf(ctx.effectClient.post.byId).toEqualTypeOf<typeof plainClient.$effect.post.byId>();
    expectTypeOf(ctx.caller.post.byId).toEqualTypeOf<typeof plainCaller.post.byId>();
    expectTypeOf(ctx.client.post.byId).returns.toEqualTypeOf<Promise<Post>>();
  });

  it('withTestServer, testWebHandler and testCaller accept typeof Svc', async () => {
    await withTestServer(AppRouter, { handlers: AppHandlers }, async (ctx) => {
      expectTypeOf(ctx).toEqualTypeOf<TestServerAndClient<AppRouterOf>>();
    });
    expectTypeOf(await testWebHandler(AppRouter, { handlers: AppHandlers })).toEqualTypeOf<
      TestWebHandler<AppRouterOf>
    >();
    expectTypeOf(testCaller(AppRouter, AppHandlers)).toEqualTypeOf<Caller<AppRouterOf>>();
  });

  it('the handler layer is still checked', () => {
    expectTypeOf(missing).not.toExtend<typeof AppHandlers>();
    // @ts-expect-error - the handlers of the service's procedures are required
    void testServerAndClient(AppRouter, { handlers: AppHandlers.pipe(() => missing) });
  });
});

declare const missing: import('effect').Layer.Layer<never>;
