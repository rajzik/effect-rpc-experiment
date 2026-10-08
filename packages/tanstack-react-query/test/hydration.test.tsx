// @vitest-environment jsdom
// Schema-aware SSR hydration: `dehydrate` encodes with the procedures' schemas, `hydrate` /
// `HydrationBoundary` restore class instances, typed errors and defects.
import { createClient, localLink } from '@effect-trpc/client';
import { RpcDefect } from '@effect-trpc/core';
import { QueryClientProvider, useQuery, type DehydratedState } from '@tanstack/react-query';
import { cleanup, render } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, test } from 'vite-plus/test';
import {
  createHydrationHelpers,
  createRpcContext,
  createRpcOptionsProxy,
  dehydrate,
  hydrate,
} from '../src/index.js';
import { appRouter, makeFixture, Post, PostNotFound, type AppRouter } from './fixtures.js';
import { makeQueryClient } from './helpers.js';

const { RpcProvider, useRpc } = createRpcContext<AppRouter>();
const helpers = createHydrationHelpers(appRouter);
const todosDate = new Date('2020-01-01T00:00:00.000Z');

/** Prefetches on a "server" query client and dehydrates it (as JSON, like an SSR payload). */
const serverState = async (keyPrefix?: string) => {
  const fixture = makeFixture();
  const client = createClient(appRouter, { link: localLink({ handlers: fixture.handlers }) });
  const queryClient = makeQueryClient();
  const rpc = createRpcOptionsProxy<AppRouter, { keyPrefix: boolean }>({
    client,
    queryClient,
    ...(keyPrefix !== undefined && { keyPrefix }),
  } as never);
  await queryClient.prefetchQuery(rpc.post.byId.queryOptions({ id: 1 }));
  await queryClient.prefetchQuery(rpc.post.byId.queryOptions({ id: 404 }));
  await queryClient.prefetchQuery(rpc.boom.queryOptions());
  await queryClient.prefetchInfiniteQuery({
    ...rpc.post.list.infiniteQueryOptions({}, { getNextPageParam: (page) => page.nextCursor }),
    pages: 2,
  });
  const todos = { at: todosDate };
  queryClient.setQueryData(['todos'], todos);
  const state = helpers.dehydrate(queryClient);
  await client.dispose();
  queryClient.clear();
  return { state, json: JSON.parse(JSON.stringify(state)) as DehydratedState, todos };
};

const keyOf = (state: DehydratedState, fragment: string) =>
  state.queries.find((q) => JSON.stringify(q.queryKey).includes(fragment));

describe('dehydrate', () => {
  test('encodes data and errors of the router queries to JSON-safe values', async () => {
    const { state, todos } = await serverState();
    const byId = keyOf(state, '"id":1');
    expect(byId?.state.data).toEqual({
      id: 1,
      title: 'Hello world',
      createdAt: '2026-01-02T03:04:05.000Z',
    });
    expect(byId?.state.data).not.toBeInstanceOf(Post);
    // failed queries are included with their error encoded as an Exit
    const notFound = keyOf(state, '"id":404');
    expect(notFound?.state.status).toBe('error');
    expect(notFound?.state.fetchFailureReason).toBeNull();
    expect(notFound?.state.error).toEqual({
      _tag: 'Failure',
      cause: [{ _tag: 'Fail', error: { _tag: 'PostNotFound', id: 404 } }],
    });
    const boom = keyOf(state, 'boom');
    expect(boom?.state.error).toMatchObject({ _tag: '@effect-trpc/RpcDefect', message: 'kaboom' });
    // infinite queries: every page is encoded
    const list = keyOf(state, 'list');
    expect(list?.state.data).toMatchObject({
      pages: [
        { items: [{ title: 'Hello world', createdAt: '2026-01-02T03:04:05.000Z' }], nextCursor: 1 },
        { items: [{ title: 'Post 2' }], nextCursor: 2 },
      ],
      pageParams: [undefined, 1],
    });
    // unknown keys pass through unchanged
    expect(keyOf(state, 'todos')?.state.data).toBe(todos);
    expect(keyOf(state, 'todos')).not.toHaveProperty('effectTrpc');
    expect(keyOf(state, 'byId')).toHaveProperty('effectTrpc', { type: 'query' });
  });

  test('dehydrateErrors: false leaves failed queries out', async () => {
    const fixture = makeFixture();
    const client = createClient(appRouter, { link: localLink({ handlers: fixture.handlers }) });
    const queryClient = makeQueryClient();
    const rpc = createRpcOptionsProxy({ client, queryClient });
    await queryClient.prefetchQuery(rpc.post.byId.queryOptions({ id: 404 }));
    await queryClient.prefetchQuery(rpc.post.byId.queryOptions({ id: 2 }));
    const state = dehydrate(appRouter, queryClient, { dehydrateErrors: false });
    expect(state.queries.map((q) => q.queryKey)).toEqual([
      [['post', 'byId'], { input: { id: 2 }, type: 'query' }],
    ]);
    await client.dispose();
  });
});

describe('hydrate', () => {
  test('HydrationBoundary renders hydrated class instances (methods, Dates)', async () => {
    const { json } = await serverState();
    const fixture = makeFixture();
    const client = createClient(appRouter, { link: localLink({ handlers: fixture.handlers }) });
    const queryClient = makeQueryClient();
    const seen: Array<unknown> = [];

    function Post1() {
      const rpc = useRpc();
      const query = useQuery({ ...rpc.post.byId.queryOptions({ id: 1 }), staleTime: Infinity });
      seen.push(query.data);
      if (!query.data) return <>...</>;
      return <pre>{`${query.data.shout()}|${query.data.createdAt.toISOString()}`}</pre>;
    }

    const utils = render(
      <QueryClientProvider client={queryClient}>
        <RpcProvider client={client} queryClient={queryClient}>
          <helpers.HydrationBoundary state={json}>
            <Post1 />
          </helpers.HydrationBoundary>
        </RpcProvider>
      </QueryClientProvider>,
    );
    try {
      // hydrated during the first render: no loading state, no request
      expect(utils.container.textContent).toBe('HELLO WORLD!|2026-01-02T03:04:05.000Z');
      expect(seen[0]).toBeInstanceOf(Post);
      expect(fixture.state.headers).toHaveLength(0);

      const rpc = createRpcOptionsProxy({ client, queryClient });
      const error = queryClient.getQueryState(rpc.post.byId.queryKey({ id: 404 }))?.error;
      expect(error).toBeInstanceOf(PostNotFound);
      expect(error?._tag === 'PostNotFound' && error.id).toBe(404);
      expect(
        queryClient.getQueryState(rpc.post.byId.queryKey({ id: 404 }))?.fetchFailureReason,
      ).toBe(error);
      expect(queryClient.getQueryState(rpc.boom.queryKey())?.error).toBeInstanceOf(RpcDefect);

      const pages = queryClient.getQueryData(rpc.post.list.infiniteQueryKey({}))?.pages;
      expect(pages?.map((page) => page.items[0]?.shout())).toEqual(['HELLO WORLD!', 'POST 2!']);
      expect(pages?.[0]?.items[0]?.createdAt).toBeInstanceOf(Date);

      // unknown keys are hydrated untouched (here: whatever JSON made of them)
      expect(queryClient.getQueryData(['todos'])).toEqual({ at: todosDate.toISOString() });
    } finally {
      cleanup();
      queryClient.clear();
      await client.dispose();
    }
  });

  test('hydrate() restores instances imperatively, also for prefixed keys', async () => {
    const { json } = await serverState('tenant-1');
    expect(keyOf(json, 'tenant-1')).toBeDefined();
    const queryClient = makeQueryClient();
    hydrate(appRouter, queryClient, json);
    const post = queryClient.getQueryData([
      ['tenant-1'],
      ['post', 'byId'],
      { input: { id: 1 }, type: 'query' },
    ]);
    expect(post).toBeInstanceOf(Post);
    expect((post as Post).createdAt).toBeInstanceOf(Date);
    const error = queryClient.getQueryState([
      ['tenant-1'],
      ['post', 'byId'],
      { input: { id: 404 }, type: 'query' },
    ])?.error;
    expect(error).toBeInstanceOf(PostNotFound);
    // a null / undefined state is ignored
    expect(() => helpers.hydrate(queryClient, undefined)).not.toThrow();
    queryClient.clear();
  });

  test('composes with serializeData / deserializeData', async () => {
    const fixture = makeFixture();
    const client = createClient(appRouter, { link: localLink({ handlers: fixture.handlers }) });
    const queryClient = makeQueryClient();
    const rpc = createRpcOptionsProxy({ client, queryClient });
    await queryClient.prefetchQuery(rpc.post.byId.queryOptions({ id: 2 }));
    queryClient.setQueryData(['plain'], 'value');
    const state = helpers.dehydrate(queryClient, {
      serializeData: (data: unknown) => ({ wrapped: data }),
    });
    expect(keyOf(state, 'plain')?.state.data).toEqual({ wrapped: 'value' });
    expect(keyOf(state, 'byId')?.state.data).toMatchObject({ wrapped: { title: 'Post 2' } });

    const target = makeQueryClient();
    helpers.hydrate(target, JSON.parse(JSON.stringify(state)) as DehydratedState, {
      defaultOptions: { deserializeData: (data: { wrapped: unknown }) => data.wrapped },
    });
    expect(target.getQueryData(['plain'])).toBe('value');
    expect(target.getQueryData(rpc.post.byId.queryKey({ id: 2 }))).toBeInstanceOf(Post);
    await client.dispose();
  });

  test('pending queries: the dehydrated promise resolves to decoded instances', async () => {
    const fixture = makeFixture();
    const client = createClient(appRouter, { link: localLink({ handlers: fixture.handlers }) });
    const queryClient = makeQueryClient();
    const rpc = createRpcOptionsProxy({ client, queryClient });
    void queryClient.prefetchQuery(rpc.post.byId.queryOptions({ id: 3 }));
    const state = helpers.dehydrate(queryClient, { shouldDehydrateQuery: () => true });
    expect(state.queries[0]?.state.status).toBe('pending');
    const promise = state.queries[0]?.promise;
    await expect(promise).resolves.toMatchObject({
      title: 'Post 3',
      createdAt: '2026-01-02T03:04:05.000Z',
    });

    const target = makeQueryClient();
    helpers.hydrate(target, state);
    const post = await target.fetchQuery({
      ...rpc.post.byId.queryOptions({ id: 3 }),
      staleTime: Infinity,
    });
    expect(post).toBeInstanceOf(Post);
    await client.dispose();
  });

  test('queries that fail to decode are dropped (and refetched by the client)', async () => {
    const { json } = await serverState();
    const broken = structuredClone(json);
    const byId = keyOf(broken, '"id":1');
    (byId!.state as { data: unknown }).data = { id: 'not a number' };
    const queryClient = makeQueryClient();
    hydrate(appRouter, queryClient, broken);
    expect(
      queryClient.getQueryData([['post', 'byId'], { input: { id: 1 }, type: 'query' }]),
    ).toBeUndefined();
    expect(queryClient.getQueryData(['todos'])).toBeDefined();
  });
});
