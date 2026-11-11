// `enabled` / `skipToken` contract of the manual `subscriptionOptions(...).subscribe` (issue #26).
import { createClient, localLink, type Client } from '@rpc-effect/client';
import { describe, expect, test, vi } from 'vite-plus/test';
import { createRpcOptionsProxy, skipToken } from '../src/index.js';
import { appRouter, makeFixture, type AppRouter } from './fixtures.js';

/** A client over the fixture handlers that records every `ticks` call. */
const spiedClient = () => {
  const client = createClient(appRouter, { link: localLink({ handlers: makeFixture().handlers }) });
  const calls: Array<unknown> = [];
  const spied = new Proxy(client, {
    get: (target, key): unknown =>
      key === 'ticks'
        ? (input: unknown, options: unknown) => {
            calls.push(input);
            return Reflect.apply(target.ticks, target, [input, options]);
          }
        : Reflect.get(target, key),
  }) satisfies Client<AppRouter>;
  return { client: spied, calls };
};

describe('subscriptionOptions(...).subscribe', () => {
  test('ignores enabled: false, like tRPC (only useSubscription honours it)', async () => {
    const { client, calls } = spiedClient();
    await using _ = client;
    const rpc = createRpcOptionsProxy({ client });
    const data: Array<number> = [];
    const options = rpc.ticks.subscriptionOptions({ n: 1 }, { enabled: false });
    expect(options.enabled).toBe(false);
    await new Promise<void>((resolve) => {
      options.subscribe({ onData: (n) => data.push(n), onComplete: resolve });
    });
    expect(data).toEqual([0]);
    expect(calls).toEqual([{ n: 1 }]);
  });

  test('skipToken starts no request and calls no callback', async () => {
    const { client, calls } = spiedClient();
    await using _ = client;
    const rpc = createRpcOptionsProxy({ client });
    const onEvent = vi.fn<(...args: Array<unknown>) => void>();
    const stop = rpc.ticks.subscriptionOptions(skipToken).subscribe({
      onStarted: onEvent,
      onData: onEvent,
      onError: onEvent,
      onComplete: onEvent,
      onConnectionStateChange: onEvent,
    });
    expect(calls).toEqual([]);
    // An ordinary subscription on the same client still runs to completion.
    await new Promise<void>((resolve) => {
      rpc.ticks.subscriptionOptions({ n: 2 }).subscribe({ onComplete: resolve });
    });
    expect(calls).toEqual([{ n: 2 }]);
    expect(onEvent).not.toHaveBeenCalled();
    stop();
  });
});
