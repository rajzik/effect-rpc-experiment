import type { Effect, Layer, Stream } from 'effect';
import type { ClientError } from '@effect-trpc/core';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import { createCaller, toWebHandler } from '../src/index.js';
import type { Caller, Handlers, WebHandler } from '../src/index.js';
import { appRouter, makeServer } from './fixtures.js';
import type { AppRouter, Auth, Forbidden, NotFound, Unauthorized, User } from './fixtures.js';

declare const caller: Caller<AppRouter>;
declare const handlersOnly: Layer.Layer<Handlers.Provides<AppRouter>>;
declare const needsService: Layer.Layer<Handlers.Requirements<AppRouter>, never, Auth>;

describe('Caller types', () => {
  it('types Effect calls with the procedure error', () => {
    expectTypeOf(caller.user.byId({ id: 'ada' })).toEqualTypeOf<
      Effect.Effect<User, NotFound | Forbidden>
    >();
    expectTypeOf(caller.health()).toEqualTypeOf<Effect.Effect<'ok'>>();
  });

  it('adds middleware errors to the procedure error', () => {
    expectTypeOf(caller.user.me()).toEqualTypeOf<Effect.Effect<User, Unauthorized>>();
  });

  it('types subscriptions as Streams / AsyncIterables', () => {
    expectTypeOf(caller.user.list({ count: 1 })).toEqualTypeOf<Stream.Stream<User>>();
    expectTypeOf(caller.$promise.user.list({ count: 1 })).toEqualTypeOf<AsyncIterable<User>>();
    expectTypeOf(caller.debug.failMidStream()).toEqualTypeOf<Stream.Stream<number, NotFound>>();
    expectTypeOf(caller.debug.nullable()).toEqualTypeOf<Stream.Stream<number | null>>();
  });

  it('types Promise calls', () => {
    expectTypeOf(caller.$promise.user.byId({ id: 'ada' })).toEqualTypeOf<Promise<User>>();
    expectTypeOf(caller.$promise.debug.ping()).toEqualTypeOf<Promise<'pong'>>();
  });

  it('checks inputs', () => {
    expectTypeOf(caller.user.byId).parameter(0).toEqualTypeOf<{ readonly id: string }>();
    // @ts-expect-error - id must be a string
    caller.user.byId({ id: 1 });
    // @ts-expect-error - payload is required
    void caller.$promise.user.byId();
    // @ts-expect-error - unknown procedure
    void caller.user.nope;
    caller.debug.ping();
    void caller.$promise.debug.headers(undefined, { headers: { 'x-trace': 't' } });
  });

  it('exposes ClientError for rejections', () => {
    type Rejection = ClientError<NotFound | Forbidden>;
    expectTypeOf<Rejection>().toExtend<{ readonly _tag: string }>();
  });
});

describe('handler layer requirements', () => {
  it('requires every handler and middleware in the layer', () => {
    expectTypeOf<Handlers.Provides<AppRouter>>().toExtend<Handlers.Requirements<AppRouter>>();
    const { layer } = makeServer();
    createCaller(appRouter, { handlers: layer });
    void toWebHandler(appRouter, { handlers: layer });

    // @ts-expect-error - Auth and Trace middleware implementations are missing
    createCaller(appRouter, { handlers: handlersOnly });
    // @ts-expect-error - Auth and Trace middleware implementations are missing
    void toWebHandler(appRouter, { handlers: handlersOnly });

    // @ts-expect-error - the layer must not have remaining requirements
    createCaller(appRouter, { handlers: needsService });
  });

  it('toWebHandler resolves to a WebHandler', () => {
    const { layer } = makeServer();
    expectTypeOf(toWebHandler(appRouter, { handlers: layer })).toEqualTypeOf<Promise<WebHandler>>();
  });
});
