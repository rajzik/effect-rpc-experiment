import { Effect, Exit, Schema, Stream } from 'effect';
import { query, Router, RpcDefect, subscription } from '@rpc-effect/core';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { createCaller, Handlers } from '../src/index.js';
import type { Caller } from '../src/index.js';
import { NotFound } from './fixtures.js';

const router = Router.make({
  slow: query({ success: Schema.String }),
  crash: query({ success: Schema.String }),
  missing: query({ success: Schema.String, error: NotFound }),
  ticks: subscription({ success: Schema.Finite }),
});

const handlers = Handlers.make(router, {
  slow: () => Effect.as(Effect.sleep('40 millis'), 'slow done'),
  crash: () => Effect.andThen(Effect.sleep('10 millis'), Effect.die(new Error('crash'))),
  missing: () => Effect.andThen(Effect.sleep('10 millis'), Effect.fail(new NotFound({ id: 'x' }))),
  ticks: () => Stream.fromIterable([1, 2, 3]).pipe(Stream.tap(() => Effect.sleep('15 millis'))),
});

let caller: Caller<typeof router>;

beforeEach(() => {
  caller = createCaller(router, { handlers });
});

afterEach(async () => {
  await caller.dispose();
});

describe('createCaller — defect isolation', () => {
  it('a defect fails only its own promise call', async () => {
    const [slow, crash] = await Promise.allSettled([
      caller.$promise.slow(),
      caller.$promise.crash(),
    ]);
    expect(slow).toEqual({ status: 'fulfilled', value: 'slow done' });
    expect(crash.status).toBe('rejected');
    const reason: unknown = crash.status === 'rejected' ? crash.reason : undefined;
    expect(reason).toBeInstanceOf(RpcDefect);
    expect(reason).toMatchObject({ message: 'crash' });
  });

  it('a defect fails only its own Effect call', async () => {
    const [slow, crash] = await Effect.runPromise(
      Effect.all([Effect.exit(caller.slow()), Effect.exit(caller.crash())], {
        concurrency: 'unbounded',
      }),
    );
    expect(Exit.isSuccess(slow) && slow.value).toBe('slow done');
    expect(Exit.hasDies(crash)).toBe(true);
  });

  it('a defect does not end an active subscription', async () => {
    const [ticks, crash] = await Promise.allSettled([
      Effect.runPromise(Stream.runCollect(caller.ticks())),
      caller.$promise.crash(),
    ]);
    expect(ticks).toEqual({ status: 'fulfilled', value: [1, 2, 3] });
    expect(crash.status).toBe('rejected');
  });

  it('a typed failure next to a defect keeps its own error', async () => {
    const [missing, crash, slow] = await Promise.allSettled([
      caller.$promise.missing(),
      caller.$promise.crash(),
      caller.$promise.slow(),
    ]);
    const reason: unknown = missing.status === 'rejected' ? missing.reason : undefined;
    expect(reason).toBeInstanceOf(NotFound);
    expect(crash.status === 'rejected' && crash.reason).toBeInstanceOf(RpcDefect);
    expect(slow).toEqual({ status: 'fulfilled', value: 'slow done' });
  });
});
