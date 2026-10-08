// Port of tRPC tests/server/procedureErrors.test.ts: typed procedure errors vs defects.
import { Effect, Schema } from 'effect';
import { mutation, query, Router, RpcDefect } from '@effect-trpc/core';
import { describe, expect, it } from 'vite-plus/test';
import { createCaller, Handlers, toWebHandler } from '../src/index.js';
import { rejection } from './fixtures.js';
import { call, exitFrame } from './wire.js';

class InsufficientFunds extends Schema.TaggedError<InsufficientFunds>()('InsufficientFunds', {
  missing: Schema.Number,
}) {}
class AccountLocked extends Schema.TaggedError<AccountLocked>()('AccountLocked', {}) {}

const router = Router.make({
  withdraw: mutation({
    payload: { amount: Schema.Number },
    success: Schema.Number,
    error: Schema.Union([InsufficientFunds, AccountLocked]),
  }),
  throws: query({ success: Schema.String }),
  throwsString: query({ success: Schema.String }),
});

const HandlersLive = Handlers.make(router, {
  withdraw: ({ amount }) => {
    if (amount < 0) return Effect.fail(new AccountLocked());
    if (amount > 100) return Effect.fail(new InsufficientFunds({ missing: amount - 100 }));
    return Effect.succeed(100 - amount);
  },
  throws: () =>
    Effect.sync((): string => {
      throw new TypeError('kaboom');
    }),
  throwsString: () =>
    Effect.sync((): string => {
      // eslint-disable-next-line no-throw-literal -- reproducing a non-Error throw
      throw 'plain string';
    }),
});

describe('procedure errors', () => {
  it('each declared error arrives as its own instance', async () => {
    const caller = createCaller(router, { handlers: HandlersLive });
    try {
      const funds = await rejection(caller.$promise.withdraw({ amount: 150 }));
      expect(funds).toBeInstanceOf(InsufficientFunds);
      expect(funds).toMatchObject({ missing: 50 });
      expect(await rejection(caller.$promise.withdraw({ amount: -1 }))).toBeInstanceOf(
        AccountLocked,
      );
      expect(await caller.$promise.withdraw({ amount: 40 })).toBe(60);
    } finally {
      await caller.dispose();
    }
  });

  it('errors can be handled by tag in the Effect API', async () => {
    const caller = createCaller(router, { handlers: HandlersLive });
    try {
      const recovered = await Effect.runPromise(
        caller.withdraw({ amount: 150 }).pipe(
          Effect.catchTags({
            InsufficientFunds: (e) => Effect.succeed(-e.missing),
            AccountLocked: () => Effect.succeed(0),
          }),
        ),
      );
      expect(recovered).toBe(-50);
    } finally {
      await caller.dispose();
    }
  });

  it('thrown exceptions are defects (RpcDefect), never typed errors', async () => {
    const caller = createCaller(router, { handlers: HandlersLive });
    try {
      const error = await rejection(caller.$promise.throws());
      expect(error).toBeInstanceOf(RpcDefect);
      expect(error).toMatchObject({ message: 'kaboom', cause: expect.any(TypeError) });
      const stringly = await rejection(caller.$promise.throwsString());
      expect(stringly).toBeInstanceOf(RpcDefect);
      expect(stringly).toMatchObject({ message: 'plain string' });
    } finally {
      await caller.dispose();
    }
  });

  it('over HTTP, typed errors are Fail and thrown exceptions are Die', async () => {
    const web = await toWebHandler(router, { handlers: HandlersLive });
    try {
      expect(exitFrame(await call(web, { tag: 'withdraw', payload: { amount: 101 } }))).toEqual({
        _tag: 'Failure',
        cause: [{ _tag: 'Fail', error: { _tag: 'InsufficientFunds', missing: 1 } }],
      });
      expect(exitFrame(await call(web, { tag: 'throws' }))).toEqual({
        _tag: 'Failure',
        cause: [{ _tag: 'Die', defect: { name: 'TypeError', message: 'kaboom' } }],
      });
    } finally {
      await web.dispose();
    }
  });
});
