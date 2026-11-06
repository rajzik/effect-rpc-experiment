// @vitest-environment jsdom
// The React bindings over a real HTTP server (`testServerAndClient`): NDJSON transport, class
// instances, typed errors, infinite queries, mutations, subscriptions and abort.
import { RpcDefect } from '@effect-trpc/core';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { fireEvent } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, test } from 'vite-plus/test';
import { useSubscription } from '../src/index.js';
import { Post, PostNotFound } from './fixtures.js';
import { testReactResource, waitFor } from './helpers.js';

describe('over HTTP', () => {
  test('queries return class instances, errors are TaggedError instances', async () => {
    await using ctx = await testReactResource({ transport: 'http' });
    const seen: Array<unknown> = [];

    function MyComponent() {
      const rpc = ctx.useRpc();
      const post = useQuery(rpc.post.byId.queryOptions({ id: 1 }));
      const missing = useQuery(rpc.post.byId.queryOptions({ id: 404 }));
      const boom = useQuery(rpc.boom.queryOptions());
      seen.push(post.data, missing.error, boom.error);
      return (
        <pre>
          {`${post.data?.shout() ?? '...'}|${missing.error?._tag ?? '...'}|${boom.error?._tag ?? '...'}`}
        </pre>
      );
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('HELLO WORLD!|PostNotFound|@effect-trpc/RpcDefect');
    });
    expect(seen.some((v) => v instanceof Post)).toBe(true);
    expect(seen.some((v) => v instanceof PostNotFound)).toBe(true);
    expect(seen.some((v) => v instanceof RpcDefect)).toBe(true);
  });

  test('infinite query and mutation', async () => {
    await using ctx = await testReactResource({ transport: 'http' });

    function MyComponent() {
      const rpc = ctx.useRpc();
      const list = useInfiniteQuery(
        rpc.post.list.infiniteQueryOptions(
          { limit: 2 },
          { getNextPageParam: (page) => page.nextCursor },
        ),
      );
      const create = useMutation(rpc.post.create.mutationOptions());
      const titles = list.data?.pages.flatMap((page) => page.items.map((p) => p.title)) ?? [];
      return (
        <>
          <button data-testid="more" onClick={() => void list.fetchNextPage()}>
            more
          </button>
          <button data-testid="create" onClick={() => create.mutate({ title: 'new' })}>
            create
          </button>
          <pre>{`${titles.join(',')}|${create.data?.shout() ?? ''}`}</pre>
        </>
      );
    }

    const utils = ctx.renderApp(<MyComponent />);
    const text = () => utils.container.querySelector('pre')?.textContent;
    await waitFor(() => {
      expect(text()).toBe('Hello world,Post 2|');
    });
    fireEvent.click(utils.getByTestId('more'));
    await waitFor(() => {
      expect(text()).toBe('Hello world,Post 2,Post 3,Post 4|');
    });
    fireEvent.click(utils.getByTestId('create'));
    await waitFor(() => {
      expect(text()).toBe('Hello world,Post 2,Post 3,Post 4|NEW!');
    });
  });

  test('subscriptions stream over HTTP and stop on unmount', async () => {
    await using ctx = await testReactResource({ transport: 'http' });

    function MyComponent() {
      const rpc = ctx.useRpc();
      const result = useSubscription(rpc.events.subscriptionOptions({ offset: 100 }));
      return <>{`status:${result.status} data:${result.data ?? ''}`}</>;
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(ctx.listenerCount()).toBe(1);
      expect(utils.container.textContent).toBe('status:pending data:');
    });
    ctx.emit(1);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('status:pending data:101');
    });
    utils.unmount();
    await waitFor(() => {
      expect(ctx.state.closed).toEqual([100]);
      expect(ctx.listenerCount()).toBe(0);
    });
  });
});
