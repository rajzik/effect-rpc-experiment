// @vitest-environment jsdom
// Port of trpc/packages/tanstack-react-query/test/queryOptions.test.tsx
import type { ClientError } from '@effect-trpc/core';
import {
  queryOptions,
  skipToken,
  useQuery,
  useSuspenseQueries,
  useSuspenseQuery,
} from '@tanstack/react-query';
import * as React from 'react';
import { describe, expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { Post, type Forbidden, type PostNotFound } from './fixtures.js';
import { testReactResource, waitFor } from './helpers.js';

describe.each(['user-123', undefined])('queryOptions with keyPrefix: %s', (keyPrefix) => {
  test('basic', async () => {
    await using ctx = await testReactResource({ keyPrefix });

    function MyComponent() {
      const rpc = ctx.useRpc();
      const options = rpc.post.byId.queryOptions({ id: 1 });
      expect(options.rpc.path).toBe('post.byId');
      const query1 = useQuery(options);
      const query2 = useQuery(rpc.post.byId.queryOptions({ id: 1 }));
      expectTypeOf(query1).toEqualTypeOf(query2);
      expectTypeOf(query1.data).toEqualTypeOf<Post | undefined>();
      expectTypeOf(query1.error).toEqualTypeOf<ClientError<PostNotFound | Forbidden> | null>();
      if (!query1.data) return <>...</>;
      return <pre>{`${query1.data.title}|${query1.data.shout()}`}</pre>;
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('Hello world|HELLO WORLD!');
    });
    const key = keyPrefix
      ? [[keyPrefix], ['post', 'byId'], { input: { id: 1 }, type: 'query' }]
      : [['post', 'byId'], { input: { id: 1 }, type: 'query' }];
    expect(ctx.queryClient.getQueryCache().getAll()[0]?.queryKey).toEqual(key);
  });

  test('select', async () => {
    await using ctx = await testReactResource({ keyPrefix });

    function MyComponent() {
      const rpc = ctx.useRpc();
      const options = rpc.post.byId.queryOptions(
        { id: 1 },
        { select: (data) => `mutated ${data.title}` as const },
      );
      expect(options.rpc.path).toBe('post.byId');
      const query1 = useQuery(options);
      if (!query1.data) return <>...</>;
      expectTypeOf(query1.data).toEqualTypeOf<`mutated ${string}`>();
      return <pre>{query1.data}</pre>;
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('mutated Hello world');
    });
  });

  test('initialData', async () => {
    await using ctx = await testReactResource({ keyPrefix });
    const initial = new Post({ id: 1, title: 'initial', createdAt: new Date(0) });

    function MyComponent() {
      const rpc = ctx.useRpc();
      const options = rpc.post.byId.queryOptions({ id: 1 }, { initialData: initial });
      expect(options.rpc.path).toBe('post.byId');
      const query1 = useQuery(options);
      expectTypeOf(query1.data).toEqualTypeOf<Post>();
      return <pre>{query1.data.title}</pre>;
    }

    const utils = ctx.renderApp(<MyComponent />);
    expect(utils.container.textContent).toBe('initial');
    // initial data is stale by default: it is refetched
    await waitFor(() => {
      expect(utils.container.textContent).toBe('Hello world');
    });
  });

  test('disabling query with skipToken', async () => {
    await using ctx = await testReactResource({ keyPrefix });

    function MyComponent() {
      const rpc = ctx.useRpc();
      const options = rpc.post.byId.queryOptions(skipToken);
      expect(options.queryFn).toBe(skipToken);
      const query1 = useQuery(options);
      const query2 = useQuery(rpc.post.byId.queryOptions(skipToken));
      expectTypeOf(query1.data).toEqualTypeOf<Post | undefined>();
      expectTypeOf(query2.data).toEqualTypeOf<Post | undefined>();
      return <pre>{`${query1.status}:${query1.fetchStatus}`}</pre>;
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('pending:idle');
    });
    expect(ctx.state.headers).toHaveLength(0);
  });

  test('regression #6701: skipToken is rejected by the suspense hooks (type-level)', async () => {
    await using ctx = await testReactResource({ keyPrefix });

    // intentionally never rendered
    function MyComponent() {
      const rpc = ctx.useRpc();
      const skipQueryOptions = rpc.post.byId.queryOptions(skipToken);
      useQuery(skipQueryOptions);
      useQuery({ queryKey: [], queryFn: skipToken });
      // @ts-expect-error skipToken is not supported by useSuspenseQuery
      useSuspenseQuery(skipQueryOptions);
      useSuspenseQueries({
        // @ts-expect-error skipToken is not supported by useSuspenseQueries
        queries: [skipQueryOptions],
      });
      useSuspenseQueries({
        // @ts-expect-error skipToken not supported directly by useSuspenseQueries
        queries: [queryOptions({ queryKey: [], queryFn: skipToken })],
      });
    }
    expect(MyComponent).toBeDefined();
  });

  test('with extra `rpc` request options (headers)', async () => {
    await using ctx = await testReactResource({ keyPrefix });

    function MyComponent() {
      const rpc = ctx.useRpc();
      const options = rpc.post.byId.queryOptions(
        { id: 1 },
        { rpc: { headers: { 'x-trace': 'abc' } } },
      );
      // the request options are replaced by the `.rpc` metadata
      expect(options.rpc).toEqual({ path: 'post.byId' });
      const query1 = useQuery(options);
      if (!query1.data) return <>...</>;
      return <pre>{query1.data.title}</pre>;
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('Hello world');
    });
    expect(ctx.state.headers).toEqual([{ 'x-trace': 'abc' }]);
  });

  test('useSuspenseQuery', async () => {
    await using ctx = await testReactResource({ keyPrefix });

    function MyComponent() {
      const rpc = ctx.useRpc();
      const { data } = useSuspenseQuery(rpc.post.byId.queryOptions({ id: 1 }));
      expectTypeOf(data).toEqualTypeOf<Post>();
      return <pre>{data.shout()}</pre>;
    }

    const utils = ctx.renderApp(
      <React.Suspense fallback={<>loading</>}>
        <MyComponent />
      </React.Suspense>,
    );
    await waitFor(() => {
      expect(utils.container.textContent).toBe('HELLO WORLD!');
    });
  });

  test('works outside React (createRpcOptionsProxy + fetchQuery)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await using ctx = await testReactResource({ keyPrefix });
    const post = await ctx.queryClient.fetchQuery(
      ctx.optionsProxy.post.byId.queryOptions({ id: 1 }),
    );
    expect(post).toBeInstanceOf(Post);
    expect(post.title).toBe('Hello world');
    // the local link never touches the network
    expect(fetchSpy).toHaveBeenCalledTimes(0);
    fetchSpy.mockRestore();
  });

  test('initialData inference (regression #6792)', async () => {
    await using ctx = await testReactResource({ keyPrefix });

    function MyComponent() {
      const rpc = ctx.useRpc();
      const options = rpc.post.titles.queryOptions(undefined, { initialData: [] });
      expect(options.rpc.path).toBe('post.titles');
      const query1 = useQuery(options);
      expectTypeOf(query1.data).toEqualTypeOf<ReadonlyArray<string>>();
      return <pre>{query1.data.join(',')}</pre>;
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.textContent).toContain('Hello world');
    });
  });

  test('initialData inference + select', async () => {
    await using ctx = await testReactResource({ keyPrefix });
    const noPost = Symbol('noPost');

    function MyComponent() {
      const rpc = ctx.useRpc();
      const options = rpc.post.titles.queryOptions(undefined, {
        initialData: [],
        select: (data) => data[0] ?? noPost,
      });
      const query1 = useQuery(options);
      expectTypeOf(query1.data).toEqualTypeOf<string | typeof noPost>();
      return <pre>{typeof query1.data === 'string' ? query1.data : 'none'}</pre>;
    }

    const utils = ctx.renderApp(<MyComponent />);
    expect(utils.container.textContent).toBe('none');
    await waitFor(() => {
      expect(utils.container.textContent).toBe('Hello world');
    });
  });

  test('queries without input', async () => {
    await using ctx = await testReactResource({ keyPrefix });

    function MyComponent() {
      const rpc = ctx.useRpc();
      const query1 = useQuery(rpc.health.queryOptions());
      expectTypeOf(query1.data).toEqualTypeOf<'ok' | undefined>();
      return <pre>{query1.data ?? '...'}</pre>;
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('ok');
    });
    expect(ctx.optionsProxy.health.queryKey()).toEqual(
      keyPrefix ? [[keyPrefix], ['health'], { type: 'query' }] : [['health'], { type: 'query' }],
    );
  });

  test('TanStack cancellation aborts the RPC (the handler is interrupted)', async () => {
    await using ctx = await testReactResource({ keyPrefix });
    const options = ctx.optionsProxy.slow.queryOptions();
    const result = ctx.queryClient.fetchQuery(options).catch((error: unknown) => error);
    await vi.waitFor(() => {
      expect(ctx.state.slow.started).toBe(1);
    });
    await ctx.queryClient.cancelQueries({ queryKey: options.queryKey });
    await vi.waitFor(() => {
      expect(ctx.state.slow.interrupted).toBe(1);
    });
    expect(await result).toMatchObject({ revert: true });
  });
});
