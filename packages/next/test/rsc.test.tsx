// @vitest-environment jsdom
// React Server Components helpers (tRPC's `trpc/server.tsx`): per-request query client, in-process
// prefetch, Schema-aware `HydrateClient`.
import { RpcDefect } from '@effect-trpc/core';
import { hydrate } from '@effect-trpc/tanstack-react-query';
import { testServerAndClient } from '@effect-trpc/test-utils';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  type DehydratedState,
  type QueryClient as QueryClientType,
} from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import { createRscHelpers, makeQueryClient, type CacheFn } from '../src/index.js';
import { appRouter, makeFixture, Post, PostNotFound } from './fixtures.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A fake `React.cache`: one value per function and "request" (scope). */
const requestScopes = () => {
  let scope = new Map<unknown, unknown>();
  const cache: CacheFn =
    <T,>(fn: () => T) =>
    (): T => {
      if (!scope.has(fn)) scope.set(fn, fn());
      return scope.get(fn) as T;
    };
  return {
    cache,
    nextRequest: (): void => {
      scope = new Map();
    },
  };
};

/** Waits until nothing is fetching any more. */
const settled = (queryClient: QueryClientType): Promise<void> =>
  vi.waitFor(() => {
    expect(queryClient.isFetching()).toBe(0);
  });

const setup = () => {
  const fixture = makeFixture();
  const scopes = requestScopes();
  const helpers = createRscHelpers(
    appRouter,
    { handlers: fixture.handlers },
    { cache: scopes.cache },
  );
  return { ...fixture, ...scopes, ...helpers };
};

describe('createRscHelpers', () => {
  test('getQueryClient() is the same within a request and a new one across requests', () => {
    const { getQueryClient, nextRequest } = setup();
    const first = getQueryClient();
    expect(getQueryClient()).toBe(first);
    expect(first.getDefaultOptions().queries?.staleTime).toBe(30_000);
    nextRequest();
    expect(getQueryClient()).not.toBe(first);
  });

  test('prefetch runs in-process (no HTTP) and dehydrate encodes Schema.Class data to JSON', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { getQueryClient, rpc, prefetch, dehydrate, state, client } = setup();
    prefetch(rpc.post.byId.queryOptions({ id: 1 }));
    await settled(getQueryClient());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.calls).toEqual(['post.byId']);
    const dehydrated = dehydrate();
    const json = JSON.parse(JSON.stringify(dehydrated)) as DehydratedState;
    expect(json.queries[0]?.state.data).toEqual({
      id: 1,
      title: 'Hello world',
      createdAt: '2026-01-02T03:04:05.000Z',
    });
    // a fresh (browser) query client hydrated with the JSON gets a real `Post`
    const browser = new QueryClient();
    hydrate(appRouter, browser, json);
    const post = browser.getQueryData(rpc.post.byId.queryKey({ id: 1 }));
    expect(post).toBeInstanceOf(Post);
    expect(post?.shout()).toBe('HELLO WORLD!');
    expect(post?.createdAt).toBeInstanceOf(Date);
    await client.dispose();
  });

  test('prefetch uses prefetchInfiniteQuery for infinite query options', async () => {
    const { getQueryClient, rpc, prefetch, dehydrate, client } = setup();
    const options = rpc.post.list.infiniteQueryOptions(
      { limit: 1 },
      { getNextPageParam: (page) => page.nextCursor },
    );
    prefetch(options);
    await settled(getQueryClient());
    const data = getQueryClient().getQueryData(options.queryKey);
    expect(data?.pages).toHaveLength(1);
    expect(data?.pages[0]?.items[0]).toBeInstanceOf(Post);
    const json = JSON.parse(JSON.stringify(dehydrate())) as DehydratedState;
    expect(json.queries[0]?.state.data).toMatchObject({
      pages: [{ items: [{ id: 1, createdAt: '2026-01-02T03:04:05.000Z' }], nextCursor: 1 }],
    });
    const browser = new QueryClient();
    hydrate(appRouter, browser, json);
    expect(browser.getQueryData(options.queryKey)?.pages[0]?.items[0]).toBeInstanceOf(Post);
    await client.dispose();
  });

  test('pending queries are dehydrated: their promise resolves to encoded data', async () => {
    const { rpc, prefetch, dehydrate, client } = setup();
    prefetch(rpc.post.byId.queryOptions({ id: 2 }));
    // not awaited: the query is still pending, like a streamed RSC render
    const state = dehydrate();
    expect(state.queries[0]?.state.status).toBe('pending');
    expect(state.queries[0]?.promise).toBeDefined();
    const browser = new QueryClient();
    hydrate(appRouter, browser, state);
    await settled(browser);
    await vi.waitFor(() => {
      expect(browser.getQueryData(rpc.post.byId.queryKey({ id: 2 }))).toBeInstanceOf(Post);
    });
    await client.dispose();
  });

  test('failed prefetches carry the typed error (and defects) through hydration', async () => {
    const { getQueryClient, rpc, prefetch, dehydrate, client } = setup();
    prefetch(rpc.post.byId.queryOptions({ id: 404 }));
    prefetch(rpc.boom.queryOptions());
    await settled(getQueryClient());
    const json = JSON.parse(JSON.stringify(dehydrate())) as DehydratedState;
    const browser = new QueryClient();
    hydrate(appRouter, browser, json);
    const notFound = browser.getQueryState(rpc.post.byId.queryKey({ id: 404 }));
    expect(notFound?.error).toBeInstanceOf(PostNotFound);
    const boom = browser.getQueryState(rpc.boom.queryKey());
    expect(boom?.error).toBeInstanceOf(RpcDefect);
    await client.dispose();
  });

  test('HydrateClient renders children inside the Schema-aware HydrationBoundary', async () => {
    const { rpc, prefetch, getQueryClient, HydrateClient, client } = setup();
    prefetch(rpc.post.byId.queryOptions({ id: 1 }));
    await settled(getQueryClient());

    // the "client side": its own query client, reading the hydrated data
    const browser = makeQueryClient();
    const seen: Array<unknown> = [];
    const PostView = (): React.ReactElement => {
      const query = useQuery({ ...rpc.post.byId.queryOptions({ id: 1 }), enabled: false });
      seen.push(query.data);
      return <p>{query.data?.shout() ?? 'loading'}</p>;
    };
    render(
      <QueryClientProvider client={browser}>
        <HydrateClient>
          <PostView />
        </HydrateClient>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('HELLO WORLD!')).toBeDefined();
    expect(seen.at(-1)).toBeInstanceOf(Post);
    await act(() => client.dispose());
  });

  test('a custom HydrationBoundary (from a "use client" module) receives the encoded state', () => {
    const fixture = makeFixture();
    const received: Array<DehydratedState> = [];
    const Boundary = (props: {
      readonly state: DehydratedState;
      readonly children?: React.ReactNode;
    }): React.ReactElement => {
      received.push(props.state);
      return <section>{props.children}</section>;
    };
    const { HydrateClient, getQueryClient } = createRscHelpers(
      appRouter,
      { handlers: fixture.handlers },
      { HydrationBoundary: Boundary, cache: requestScopes().cache },
    );
    getQueryClient().setQueryData(['todos'], ['a']);
    render(
      <HydrateClient>
        <span>child</span>
      </HydrateClient>,
    );
    expect(screen.getByText('child')).toBeDefined();
    expect(received[0]?.queries.map((q) => q.queryKey)).toEqual([['todos']]);
  });

  test('caller reads data directly in a server component (no query cache)', async () => {
    const { caller, getQueryClient } = setup();
    const post = await caller.$promise.post.byId({ id: 3 });
    expect(post).toBeInstanceOf(Post);
    await expect(caller.$promise.post.byId({ id: 404 })).rejects.toBeInstanceOf(PostNotFound);
    expect(getQueryClient().getQueryCache().getAll()).toHaveLength(0);
    await caller.dispose();
  });

  test('headers are forwarded to in-process calls (e.g. Next `headers()`)', async () => {
    const fixture = makeFixture();
    const { rpc, getQueryClient, client } = createRscHelpers(
      appRouter,
      { handlers: fixture.handlers, headers: async () => new Headers({ 'x-user': 'ada' }) },
      { cache: requestScopes().cache },
    );
    expect(await getQueryClient().fetchQuery(rpc.post.whoami.queryOptions())).toBe('ada');
    await client.dispose();
  });

  test('keyPrefix prefixes the query keys', async () => {
    const fixture = makeFixture();
    const { rpc, prefetch, getQueryClient, client } = createRscHelpers(
      appRouter,
      { handlers: fixture.handlers },
      { cache: requestScopes().cache, keyPrefix: 'blog' },
    );
    const options = rpc.post.list.infiniteQueryOptions(
      {},
      { getNextPageParam: (page) => page.nextCursor },
    );
    expect(options.queryKey[0]).toEqual(['blog']);
    prefetch(options);
    await settled(getQueryClient());
    expect(getQueryClient().getQueryData(options.queryKey)?.pages).toHaveLength(1);
    await client.dispose();
  });

  test('external client mode prefetches over real HTTP', async () => {
    const fixture = makeFixture();
    await using server = await testServerAndClient(appRouter, { handlers: fixture.handlers });
    const { rpc, prefetch, getQueryClient, dehydrate } = createRscHelpers(
      appRouter,
      { client: server.client },
      { cache: requestScopes().cache },
    );
    expect('caller' in createRscHelpers(appRouter, { client: server.client })).toBe(false);
    prefetch(rpc.post.byId.queryOptions({ id: 1 }));
    await settled(getQueryClient());
    expect(getQueryClient().getQueryData(rpc.post.byId.queryKey({ id: 1 }))).toBeInstanceOf(Post);
    expect(JSON.stringify(dehydrate())).toContain('"createdAt":"2026-01-02T03:04:05.000Z"');
  });
});
