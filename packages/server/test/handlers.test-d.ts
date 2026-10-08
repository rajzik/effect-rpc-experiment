import { Context, Effect, Layer, Schema, Stream } from 'effect';
import type { Rpc } from 'effect/rpc';
import { query, Router, subscription } from '@effect-trpc/core';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import { Handlers } from '../src/index.js';
import { ada, appRouter, Forbidden, NotFound, User } from './fixtures.js';

const router = Router.make({
  user: {
    byId: query({ payload: { id: Schema.String }, success: User, error: NotFound }),
    feed: subscription({ success: Schema.Number }),
  },
});

class Db extends Context.Service<Db, { readonly find: (id: string) => User }>()('Db') {}

describe('Handlers.make types', () => {
  it('infers payload and context types from the router', () => {
    Handlers.make(router, {
      user: {
        byId: (payload, ctx) => {
          expectTypeOf(payload).toEqualTypeOf<{ readonly id: string }>();
          expectTypeOf(ctx.headers['x-user']).toEqualTypeOf<string | undefined>();
          expectTypeOf(ctx.requestId).toEqualTypeOf<import('effect/rpc').RpcMessage.RequestId>();
          return Effect.succeed(ada());
        },
        feed: () => Stream.make(1, 2),
      },
    });
  });

  it('returns a layer of the router handlers', () => {
    const layer = Handlers.make(router, {
      user: { byId: () => Effect.succeed(ada()), feed: () => Stream.empty },
    });
    expectTypeOf(layer).toEqualTypeOf<
      Layer.Layer<Rpc.Handler<'user.byId'> | Rpc.Handler<'user.feed'>>
    >();
  });

  it('tracks services used by handlers and by the building Effect', () => {
    class Config extends Context.Service<Config, { readonly prefix: string }>()('Config') {}
    const layer = Handlers.make(
      router,
      Effect.gen(function* () {
        const config = yield* Config;
        return Handlers.of(router, {
          user: {
            byId: ({ id }) =>
              Effect.gen(function* () {
                const db = yield* Db;
                return db.find(`${config.prefix}${id}`);
              }),
            feed: () => Stream.empty,
          },
        });
      }),
    );
    expectTypeOf(layer).toEqualTypeOf<
      Layer.Layer<Rpc.Handler<'user.byId'> | Rpc.Handler<'user.feed'>, never, Config | Db>
    >();
  });

  it('rejects a missing handler', () => {
    expectTypeOf<keyof Handlers.From<typeof router>['user']>().toEqualTypeOf<'byId' | 'feed'>();
    // @ts-expect-error - "feed" is missing
    Handlers.make(router, { user: { byId: () => Effect.succeed(ada()) } });
    // @ts-expect-error - the whole "user" namespace is missing
    Handlers.make(router, {});
  });

  it('rejects a wrong success type', () => {
    type ByIdResult = ReturnType<Handlers.From<typeof router>['user']['byId']>;
    expectTypeOf(Effect.succeed(ada())).toExtend<ByIdResult>();
    expectTypeOf(Effect.succeed('not a user')).not.toExtend<ByIdResult>();
    Handlers.make(router, {
      user: {
        // @ts-expect-error - must succeed with a User
        byId: () => Effect.succeed('not a user'),
        feed: () => Stream.empty,
      },
    });
  });

  it('rejects an undeclared error type', () => {
    expectTypeOf<Forbidden>().not.toExtend<NotFound>();
    Handlers.make(router, {
      user: {
        // @ts-expect-error - Forbidden is not part of user.byId's error schema
        byId: () => Effect.fail(new Forbidden({ reason: 'no' })),
        feed: () => Stream.empty,
      },
    });
  });

  it('requires a Stream (or Queue) for subscriptions', () => {
    expectTypeOf(Stream.make(1)).toExtend<
      ReturnType<Handlers.From<typeof router>['user']['feed']>
    >();
    Handlers.make(router, {
      user: {
        byId: () => Effect.succeed(ada()),
        // @ts-expect-error - subscriptions return a Stream, not an Effect of a value
        feed: () => Effect.succeed(1),
      },
    });
  });

  it('types the nested record and the flat record', () => {
    expectTypeOf<keyof Handlers.From<typeof appRouter>>().toEqualTypeOf<
      'health' | 'user' | 'debug'
    >();
    expectTypeOf<keyof Handlers.From<typeof appRouter>['user']>().toEqualTypeOf<
      'byId' | 'create' | 'list' | 'me'
    >();
    expectTypeOf<keyof Handlers.Flat<typeof router>>().toEqualTypeOf<'user.byId' | 'user.feed'>();
  });

  it('Handlers.flat rejects missing tags', () => {
    expectTypeOf<Handlers.Flat<typeof router>['user.byId']>().toBeFunction();
    // @ts-expect-error - "user.feed" is missing
    Handlers.flat(router, { 'user.byId': () => Effect.succeed(ada()) });
  });
});
