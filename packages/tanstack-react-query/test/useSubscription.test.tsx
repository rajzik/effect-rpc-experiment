// @vitest-environment jsdom
// Port of trpc/packages/tanstack-react-query/test/useSubscription.test.tsx
import type { ClientError } from '@effect-trpc/core';
import { act, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { skipToken, useSubscription, type RpcSubscriptionResult } from '../src/index.js';
import { Post, PostNotFound } from './fixtures.js';
import { testReactResource, waitFor } from './helpers.js';

/** The fields that changed between consecutive results. */
const diff = (list: ReadonlyArray<Record<string, unknown>>) =>
  list.map((item, index) => {
    if (index === 0) return item;
    const prev = list[index - 1]!;
    const changed: Record<string, unknown> = {};
    for (const key in item) if (item[key] !== prev[key]) changed[key] = item[key];
    return changed;
  });

describe('useSubscription', () => {
  test('iterable: connecting → pending → data, stops when disabled', async () => {
    await using ctx = await testReactResource();
    const onData = vi.fn<(data: number) => void>();
    const onError = vi.fn<(error: unknown) => void>();
    const onStarted = vi.fn<() => void>();

    function MyComponent() {
      const [enabled, setEnabled] = React.useState(true);
      const rpc = ctx.useRpc();
      const result = useSubscription(
        rpc.events.subscriptionOptions(
          { offset: 10 },
          {
            enabled,
            onStarted,
            onData: (data) => {
              expectTypeOf(data).toEqualTypeOf<number>();
              onData(data);
            },
            onError,
          },
        ),
      );
      expectTypeOf(result.data).toEqualTypeOf<number | undefined>();
      return (
        <>
          <button data-testid="toggle" onClick={() => setEnabled((it) => !it)}>
            toggle
          </button>
          <div>{`status:${result.status}`}</div>
          <div>{`data:${result.data ?? 'NO_DATA'}`}</div>
        </>
      );
    }

    const utils = ctx.renderApp(<MyComponent />);
    expect(utils.container.textContent).toContain('status:connecting');
    await waitFor(() => {
      expect(utils.container.textContent).toContain('status:pending');
      expect(ctx.listenerCount()).toBe(1);
    });
    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledTimes(0);

    act(() => ctx.emit(20));
    await waitFor(() => {
      expect(utils.container.textContent).toContain('data:30');
    });
    expect(onData.mock.calls).toEqual([[30]]);
    expect(onError).toHaveBeenCalledTimes(0);

    fireEvent.click(utils.getByTestId('toggle'));
    await waitFor(() => {
      expect(utils.container.textContent).toContain('status:idle');
      expect(ctx.listenerCount()).toBe(0);
    });
    expect(ctx.state.closed).toEqual([10]);
    expect(utils.container.textContent).toContain('data:NO_DATA');

    // re-enabling subscribes again
    fireEvent.click(utils.getByTestId('toggle'));
    await waitFor(() => {
      expect(utils.container.textContent).toContain('status:pending');
      expect(ctx.listenerCount()).toBe(1);
    });
    act(() => ctx.emit(1));
    await waitFor(() => {
      expect(utils.container.textContent).toContain('data:11');
    });
  });

  test('connection state', async () => {
    await using ctx = await testReactResource();
    const onConnectionStateChange = vi.fn<(state: unknown) => void>();
    const results: Array<Record<string, unknown>> = [];

    function MyComponent() {
      const rpc = ctx.useRpc();
      const result = useSubscription(
        rpc.events.subscriptionOptions({ offset: 10 }, { onConnectionStateChange }),
      );
      results.push({ ...result });
      return <>{`status:${result.status} data:${result.data ?? ''}`}</>;
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.textContent).toContain('status:pending');
      expect(ctx.listenerCount()).toBe(1);
    });
    act(() => ctx.emit(20));
    await waitFor(() => {
      expect(utils.container.textContent).toContain('data:30');
    });
    expect(diff(results)).toEqual([
      { data: undefined, error: null, reset: expect.any(Function), status: 'connecting' },
      { status: 'pending' },
      { data: 30 },
    ]);
    expect(onConnectionStateChange.mock.calls).toEqual([
      [{ state: 'connecting', error: null }],
      [{ state: 'pending', error: null }],
    ]);
  });

  test('aborts on useSubscription restarts and unmount', async () => {
    await using ctx = await testReactResource();

    function MyComponent({ offset }: { offset: number }) {
      const rpc = ctx.useRpc();
      const result = useSubscription(rpc.events.subscriptionOptions({ offset }));
      return <>{`status:${result.status} data:${result.data ?? 'NO_DATA'}`}</>;
    }

    const utils = ctx.renderApp(<MyComponent offset={1} />);
    await waitFor(() => {
      expect(ctx.listenerCount()).toBe(1);
    });
    act(() => ctx.emit(10));
    await waitFor(() => {
      expect(utils.container.textContent).toBe('status:pending data:11');
    });

    ctx.rerenderApp(utils, <MyComponent offset={2} />);
    await waitFor(() => {
      expect(ctx.state.closed).toEqual([1]);
      expect(ctx.listenerCount()).toBe(1);
    });
    expect(utils.container.textContent).toBe('status:pending data:NO_DATA');
    act(() => ctx.emit(10));
    await waitFor(() => {
      expect(utils.container.textContent).toBe('status:pending data:12');
    });

    utils.unmount();
    await waitFor(() => {
      expect(ctx.state.closed).toEqual([1, 2]);
      expect(ctx.listenerCount()).toBe(0);
    });
  });

  test('reset', async () => {
    await using ctx = await testReactResource();
    const results: Array<RpcSubscriptionResult<number, unknown>> = [];

    function MyComponent() {
      const rpc = ctx.useRpc();
      const result = useSubscription(rpc.events.subscriptionOptions({ offset: 10 }));
      results.push({ ...result });
      return (
        <>
          <>{`status:${result.status} data:${result.data ?? ''}`}</>
          <button data-testid="reset" onClick={() => result.reset()}>
            reset
          </button>
        </>
      );
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(ctx.listenerCount()).toBe(1);
    });
    act(() => ctx.emit(20));
    await waitFor(() => {
      expect(utils.container.textContent).toContain('data:30');
    });
    results.length = 0;

    fireEvent.click(utils.getByTestId('reset'));
    await waitFor(() => {
      expect(utils.container.textContent).toContain('status:pending');
      expect(ctx.listenerCount()).toBe(1);
    });
    expect(ctx.state.closed).toEqual([10]);
    expect(results[0]?.status).toBe('connecting');
    expect(results[0]?.data).toBeUndefined();
    expect(diff(results as never)).toEqual([
      { data: undefined, error: null, reset: expect.any(Function), status: 'connecting' },
      { status: 'pending' },
    ]);
  });

  test('tracked key: two subscriptions with the same input', async () => {
    await using ctx = await testReactResource();

    function MyComponent() {
      const rpc = ctx.useRpc();
      const result1 = useSubscription(rpc.events.subscriptionOptions({ offset: 10 }));
      const result2 = useSubscription(rpc.events.subscriptionOptions({ offset: 10 }));
      return (
        <>
          {`status1:${result1.status} status2:${result2.status} `}
          {/* read result2.data only once result1 has data */}
          {`data:${result1.data === undefined ? '' : String(result2.data)}`}
        </>
      );
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('status1:pending status2:pending data:');
      expect(ctx.listenerCount()).toBe(2);
    });
    act(() => ctx.emit(20));
    await waitFor(() => {
      expect(utils.container.textContent).toBe('status1:pending status2:pending data:30');
    });
  });

  test('a typed stream error sets status error with the TaggedError instance', async () => {
    await using ctx = await testReactResource();
    const onError = vi.fn<(error: unknown) => void>();
    const errors: Array<unknown> = [];

    function MyComponent() {
      const rpc = ctx.useRpc();
      const result = useSubscription(
        rpc.ticks.subscriptionOptions({ n: 3, fail: true }, { onError }),
      );
      expectTypeOf(result.error).toEqualTypeOf<ClientError<PostNotFound> | null>();
      errors.push(result.error);
      return <>{`status:${result.status} data:${result.data ?? ''}`}</>;
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('status:error data:2');
    });
    expect(errors.at(-1)).toBeInstanceOf(PostNotFound);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  test('a completed stream keeps the last value and calls onComplete', async () => {
    await using ctx = await testReactResource();
    const onComplete = vi.fn<() => void>();
    const onData = vi.fn<(data: number) => void>();

    function MyComponent() {
      const rpc = ctx.useRpc();
      const result = useSubscription(
        rpc.ticks.subscriptionOptions({ n: 3 }, { onData, onComplete }),
      );
      return <>{`status:${result.status} data:${result.data ?? ''}`}</>;
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(utils.container.textContent).toBe('status:pending data:2');
    expect(onData.mock.calls).toEqual([[0], [1], [2]]);
  });

  test('skipToken keeps the subscription idle until an input is given', async () => {
    await using ctx = await testReactResource();

    function MyComponent({ offset }: { offset: number | undefined }) {
      const rpc = ctx.useRpc();
      const result = useSubscription(
        rpc.events.subscriptionOptions(offset === undefined ? skipToken : { offset }),
      );
      return <>{`status:${result.status}`}</>;
    }

    const utils = ctx.renderApp(<MyComponent offset={undefined} />);
    expect(utils.container.textContent).toBe('status:idle');
    expect(ctx.listenerCount()).toBe(0);
    ctx.rerenderApp(utils, <MyComponent offset={5} />);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('status:pending');
      expect(ctx.listenerCount()).toBe(1);
    });
  });

  test('subscribe() works without React and stops on abort signal', async () => {
    await using ctx = await testReactResource();
    const posts: Array<Post> = [];
    const controller = new AbortController();
    const options = ctx.optionsProxy.post.onCreated.subscriptionOptions(undefined);
    expect(options.rpc.path).toBe('post.onCreated');
    expect(options.queryKey).toEqual([['post', 'onCreated']]);
    const started = new Promise<void>((resolve) => {
      options.subscribe({
        signal: controller.signal,
        onStarted: resolve,
        onData: (p) => posts.push(p),
      });
    });
    await started;
    await vi.waitFor(() => {
      expect(ctx.state.emitter.listenerCount('created')).toBe(1);
    });
    await ctx.client.post.create({ title: 'live' });
    await vi.waitFor(() => {
      expect(posts.map((p) => p.title)).toEqual(['live']);
    });
    expect(posts[0]).toBeInstanceOf(Post);
    controller.abort();
    await vi.waitFor(() => {
      expect(ctx.state.emitter.listenerCount('created')).toBe(0);
    });
  });
});
