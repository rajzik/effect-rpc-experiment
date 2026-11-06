import type { Effect, Layer, Stream } from 'effect';
import type { RpcTransportError } from '@effect-trpc/core';
import type { Client } from '@effect-trpc/client';
import type { Caller } from '@effect-trpc/server';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import {
  assertInstance,
  testCaller,
  testServerAndClient,
  testWebHandler,
  withTestServer,
  type TestServerAndClient,
  type TestServerOptions,
} from '../src/index.js';
import { appRouter, HandlersLive, User, type AppRouter, type NotFound } from './fixtures.js';

declare const ctx: TestServerAndClient<AppRouter>;
declare const emptyLayer: Layer.Layer<never>;

describe('test-utils types', () => {
  it('types the Promise client', () => {
    expectTypeOf(ctx.client).toEqualTypeOf<Client<AppRouter>>();
    expectTypeOf(ctx.client.user.byId).returns.toEqualTypeOf<Promise<User>>();
    expectTypeOf(ctx.client.user.list).returns.toEqualTypeOf<AsyncIterable<User>>();
    expectTypeOf(ctx.url).toEqualTypeOf<string>();
  });

  it('types the Effect client error channel with the procedure errors', () => {
    expectTypeOf(ctx.effectClient.user.byId).returns.toEqualTypeOf<
      Effect.Effect<User, NotFound | RpcTransportError>
    >();
    expectTypeOf(ctx.effectClient.user.list).returns.toEqualTypeOf<
      Stream.Stream<User, RpcTransportError>
    >();
    expectTypeOf(ctx.caller).toEqualTypeOf<Caller<AppRouter>>();
  });

  it('infers the router from the arguments', () => {
    expectTypeOf(testServerAndClient(appRouter, { handlers: HandlersLive })).toEqualTypeOf<
      Promise<TestServerAndClient<AppRouter>>
    >();
    expectTypeOf(testCaller(appRouter, HandlersLive)).toEqualTypeOf<Caller<AppRouter>>();
    expectTypeOf(
      withTestServer(appRouter, { handlers: HandlersLive }, async (c) => c.port),
    ).toEqualTypeOf<Promise<number>>();
    expectTypeOf(testWebHandler(appRouter, { handlers: HandlersLive })).resolves.toHaveProperty(
      'client',
    );
  });

  it('rejects a handler layer that misses procedures', () => {
    // @ts-expect-error -- `handlers` must implement every procedure of the router
    void testServerAndClient(appRouter, { handlers: emptyLayer });
    expectTypeOf(emptyLayer).not.toExtend<TestServerOptions<AppRouter>['handlers']>();
  });

  it('narrows with assertInstance', () => {
    const value: unknown = null;
    assertInstance(value, User);
    expectTypeOf(value).toEqualTypeOf<User>();
  });
});
