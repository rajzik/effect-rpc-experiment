// @vitest-environment jsdom
// Port of trpc/packages/tanstack-react-query/test/infiniteQueryOptions.test.tsx
import type { ClientError } from '@effect-trpc/core';
import {
  skipToken,
  useInfiniteQuery,
  useQueryClient,
  useSuspenseInfiniteQuery,
  type InfiniteData,
} from '@tanstack/react-query';
import { act, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, expectTypeOf, test } from 'vite-plus/test';
import type { Post } from './fixtures.js';
import { testReactResource, waitFor } from './helpers.js';

type Page = { readonly items: ReadonlyArray<Post>; readonly nextCursor: number | null };

const titles = (data: InfiniteData<Page> | undefined): string =>
  data?.pages.map((page) => page.items.map((post) => post.title).join('+')).join('|') ?? '...';

describe('infiniteQueryOptions', () => {
  test('basic', async () => {
    await using ctx = await testReactResource();
    let invalidated = false;

    function MyComponent() {
      const rpc = ctx.useRpc();
      const queryClient = useQueryClient();
      const options = rpc.post.list.infiniteQueryOptions(
        {},
        {
          getNextPageParam: (lastPage) => {
            expectTypeOf(lastPage).toEqualTypeOf<Page>();
            return lastPage.nextCursor;
          },
        },
      );
      expect(options.rpc.path).toBe('post.list');
      const query1 = useInfiniteQuery(options);
      expectTypeOf(query1.data).toEqualTypeOf<InfiniteData<Page, number | null> | undefined>();
      expectTypeOf(query1.error).toEqualTypeOf<ClientError<never> | null>();
      if (!query1.data) return <>...</>;

      // keys and data tags
      const queryKey = rpc.post.list.infiniteQueryKey({});
      expect(options.queryKey).toEqual(queryKey);
      expect(queryKey).toEqual([['post', 'list'], { input: {}, type: 'infinite' }]);
      const cached = queryClient.getQueryData(rpc.post.list.infiniteQueryKey({}));
      expectTypeOf(cached).toEqualTypeOf<InfiniteData<Page, number | null> | undefined>();
      expect(cached).toEqual(query1.data);

      return (
        <>
          <button data-testid="fetchMore" onClick={() => void query1.fetchNextPage()}>
            more
          </button>
          <button
            data-testid="invalidate"
            onClick={() => {
              void queryClient
                .invalidateQueries(
                  rpc.post.list.infiniteQueryFilter(
                    {},
                    {
                      predicate: (query) => {
                        expect(query.state.data).toEqual(query1.data);
                        return true;
                      },
                    },
                  ),
                )
                .then(() => {
                  invalidated = true;
                });
            }}
          >
            invalidate
          </button>
          <pre>{titles(query1.data)}</pre>
        </>
      );
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.querySelector('pre')?.textContent).toBe('Hello world');
    });
    fireEvent.click(utils.getByTestId('fetchMore'));
    await waitFor(() => {
      expect(utils.container.querySelector('pre')?.textContent).toBe('Hello world|Post 2');
    });
    fireEvent.click(utils.getByTestId('invalidate'));
    await waitFor(() => {
      expect(invalidated).toBe(true);
    });
    // the first page has no cursor, the next one gets `cursor: 1`; refetching both pages again
    expect(ctx.state.listCalls).toEqual([{}, { cursor: 1 }, {}, { cursor: 1 }]);
  });

  test('basic suspense', async () => {
    await using ctx = await testReactResource();

    function MyComponent() {
      const rpc = ctx.useRpc();
      const options = rpc.post.list.infiniteQueryOptions(
        { limit: 2 },
        { getNextPageParam: (lastPage) => lastPage.nextCursor },
      );
      const query1 = useSuspenseInfiniteQuery(options);
      expectTypeOf(query1.data).toEqualTypeOf<InfiniteData<Page, number | null>>();
      return (
        <>
          <button data-testid="fetchMore" onClick={() => void query1.fetchNextPage()}>
            more
          </button>
          <pre>{titles(query1.data)}</pre>
        </>
      );
    }

    const utils = ctx.renderApp(
      <React.Suspense fallback={<>loading</>}>
        <MyComponent />
      </React.Suspense>,
    );
    await waitFor(() => {
      expect(utils.container.querySelector('pre')?.textContent).toBe('Hello world+Post 2');
    });
    fireEvent.click(utils.getByTestId('fetchMore'));
    await waitFor(() => {
      expect(utils.container.querySelector('pre')?.textContent).toBe(
        'Hello world+Post 2|Post 3+Post 4',
      );
    });
    // the key drops the cursor but keeps the rest of the input
    expect(ctx.queryClient.getQueryCache().getAll()[0]?.queryKey).toEqual([
      ['post', 'list'],
      { input: { limit: 2 }, type: 'infinite' },
    ]);
  });

  test('regression #6701: suspense infinite queries require getNextPageParam (type-level)', async () => {
    await using ctx = await testReactResource();

    // intentionally never rendered
    function MyComponent() {
      const rpc = ctx.useRpc();
      // @ts-expect-error getNextPageParam is mandatory
      rpc.post.list.infiniteQueryOptions({}, {});
      // @ts-expect-error the options are mandatory
      rpc.post.list.infiniteQueryOptions({});
      const skipped = rpc.post.list.infiniteQueryOptions(skipToken, {
        getNextPageParam: (page) => page.nextCursor,
      });
      // @ts-expect-error skipToken is not supported by useSuspenseInfiniteQuery
      useSuspenseInfiniteQuery(skipped);
    }
    expect(MyComponent).toBeDefined();
  });

  test('no infinite on non cursor types (type-level)', async () => {
    await using ctx = await testReactResource();

    // intentionally never rendered
    function MyComponent() {
      const rpc = ctx.useRpc();
      // @ts-expect-error - not an infinite query
      rpc.post.byId.infiniteQueryOptions({ id: 1 });
      // @ts-expect-error - not an infinite query
      rpc.post.byId.infiniteQueryKey({ id: 1 });
      // @ts-expect-error - not an infinite query
      rpc.post.byId.infiniteQueryFilter({ id: 1 });
      // @ts-expect-error - mutations have no infinite queries
      void rpc.post.create.infiniteQueryOptions;
    }
    expect(MyComponent).toBeDefined();
  });

  test('select', async () => {
    await using ctx = await testReactResource();

    function MyComponent() {
      const rpc = ctx.useRpc();
      const options = rpc.post.list.infiniteQueryOptions(
        {},
        {
          getNextPageParam: (lastPage) => lastPage.nextCursor,
          select: (data) => ({
            ...data,
            pages: data.pages.map((page) => ({ ...page, selected: true as const })),
          }),
        },
      );
      const query1 = useInfiniteQuery(options);
      if (!query1.data) return <>...</>;
      expectTypeOf(query1.data.pages[0]!.selected).toEqualTypeOf<true>();
      return <pre>{`${titles(query1.data)}:${String(query1.data.pages[0]?.selected)}`}</pre>;
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('Hello world:true');
    });
  });

  test('falsy cursor (regression #6599)', async () => {
    await using ctx = await testReactResource();

    function MyComponent() {
      const rpc = ctx.useRpc();
      const options = rpc.post.list.infiniteQueryOptions(
        { cursor: 0, limit: 1 },
        { getNextPageParam: (lastPage) => lastPage.nextCursor },
      );
      expect(options.initialPageParam).toBe(0);
      const query1 = useInfiniteQuery(options);
      return (
        <>
          <button data-testid="fetchMore" onClick={() => void query1.fetchNextPage()}>
            more
          </button>
          <pre>{titles(query1.data)}</pre>
        </>
      );
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.querySelector('pre')?.textContent).toBe('Hello world');
    });
    await act(async () => {
      fireEvent.click(utils.getByTestId('fetchMore'));
    });
    await waitFor(() => {
      expect(utils.container.querySelector('pre')?.textContent).toBe('Hello world|Post 2');
    });
    expect(ctx.state.listCalls).toEqual([
      { cursor: 0, limit: 1 },
      { cursor: 1, limit: 1 },
    ]);
  });

  test('initialCursor and prefetchInfiniteQuery outside React', async () => {
    await using ctx = await testReactResource();
    const options = ctx.optionsProxy.post.list.infiniteQueryOptions(
      { limit: 1 },
      { initialCursor: 2, getNextPageParam: (lastPage) => lastPage.nextCursor },
    );
    const data = await ctx.queryClient.fetchInfiniteQuery(options);
    expect(data.pageParams).toEqual([2]);
    expect(data.pages[0]?.items.map((post) => post.title)).toEqual(['Post 3']);
    expect(ctx.state.listCalls).toEqual([{ limit: 1, cursor: 2 }]);
  });
});
