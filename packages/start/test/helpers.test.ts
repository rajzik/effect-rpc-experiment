// `createStartHelpers` / `createStartHydration`: the loader + SSR hydration path of a Start app.
import { RpcDefect } from '@effect-trpc/core';
import type { DehydratedState } from '@tanstack/react-query';
import { afterEach, describe, expect, test } from 'vite-plus/test';
import { createServerClient, createStartHelpers, createStartHydration } from '../src/index.js';
import {
  appRouter,
  createdAt,
  makeFixture,
  makeQueryClient,
  Post,
  PostNotFound,
} from './fixtures.js';

const makeHelpers = () => {
  const client = createServerClient(appRouter, { handlers: makeFixture().handlers });
  return createStartHelpers(appRouter, { client });
};

const clients: Array<{ readonly dispose: () => Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.dispose()));
});

/** Serializes like an SSR payload. */
const overTheWire = (state: DehydratedState): DehydratedState =>
  JSON.parse(JSON.stringify(state)) as DehydratedState;

describe('createStartHelpers', () => {
  test('loader-style ensureQueryData returns a Post instance; the proxy is memoized per QueryClient', async () => {
    const { rpc, getRpc, client } = makeHelpers();
    clients.push(client);
    const queryClient = makeQueryClient();
    expect(rpc(queryClient)).toBe(rpc(queryClient));
    expect(getRpc(queryClient)).toBe(rpc(queryClient));
    expect(rpc(makeQueryClient())).not.toBe(rpc(queryClient));

    const post = await queryClient.ensureQueryData(
      rpc(queryClient).post.byId.queryOptions({ id: 1 }),
    );
    expect(post).toBeInstanceOf(Post);
    expect(post.shout()).toBe('HELLO WORLD!');
    // cached: the same instance is returned without refetching
    const again = await queryClient.ensureQueryData(
      rpc(queryClient).post.byId.queryOptions({ id: 1 }),
    );
    expect(again).toBe(post);
  });

  test('typed errors reject fetchQuery with the TaggedError instance', async () => {
    const { rpc, client } = makeHelpers();
    clients.push(client);
    const queryClient = makeQueryClient();
    const error = await queryClient
      .fetchQuery(rpc(queryClient).post.byId.queryOptions({ id: 404 }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PostNotFound);
    const defect = await queryClient
      .fetchQuery(rpc(queryClient).boom.queryOptions())
      .catch((e: unknown) => e);
    expect(defect).toBeInstanceOf(RpcDefect);
  });

  test('dehydrate encodes JSON-safe data; hydrate on a fresh QueryClient restores instances', async () => {
    const { rpc, hydration, client } = makeHelpers();
    clients.push(client);
    const serverQc = makeQueryClient();
    await serverQc.ensureQueryData(rpc(serverQc).post.byId.queryOptions({ id: 1 }));
    await serverQc.prefetchQuery(rpc(serverQc).post.byId.queryOptions({ id: 404 }));

    const state = overTheWire(hydration.dehydrate(serverQc));
    const encoded = state.queries.find((q) => JSON.stringify(q.queryKey).includes('"id":1'));
    expect(encoded?.state.data).toEqual({
      id: 1,
      title: 'Hello world',
      createdAt: '2026-01-02T03:04:05.000Z',
    });

    const browserQc = makeQueryClient();
    hydration.hydrate(browserQc, state);
    const post = browserQc.getQueryData(rpc(browserQc).post.byId.queryKey({ id: 1 }));
    expect(post).toBeInstanceOf(Post);
    expect(post?.shout()).toBe('HELLO WORLD!');
    expect(post?.createdAt).toEqual(createdAt);
    const failed = browserQc.getQueryState(rpc(browserQc).post.byId.queryKey({ id: 404 }));
    expect(failed?.status).toBe('error');
    expect(failed?.error).toBeInstanceOf(PostNotFound);
  });

  test('infinite queries: ensureInfiniteQueryData + dehydrate/hydrate restore every page', async () => {
    const { rpc, hydration, client } = makeHelpers();
    clients.push(client);
    const serverQc = makeQueryClient();
    const options = rpc(serverQc).post.list.infiniteQueryOptions(
      { limit: 1 },
      { getNextPageParam: (page) => page.nextCursor },
    );
    const first = await serverQc.ensureInfiniteQueryData(options);
    expect(first.pages[0]?.items[0]).toBeInstanceOf(Post);
    await serverQc.fetchInfiniteQuery({ ...options, pages: 2 });

    const browserQc = makeQueryClient();
    hydration.hydrate(browserQc, overTheWire(hydration.dehydrate(serverQc)));
    const data = browserQc.getQueryData(rpc(browserQc).post.list.infiniteQueryKey({ limit: 1 }));
    expect(data?.pages).toHaveLength(2);
    expect(data?.pages.map((page) => page.items[0]?.shout())).toEqual(['HELLO WORLD!', 'POST 2!']);
    expect(data?.pageParams).toEqual([null, 1]);
  });

  test('keyPrefix prefixes every query key', async () => {
    const client = createServerClient(appRouter, { handlers: makeFixture().handlers });
    clients.push(client);
    const { rpc } = createStartHelpers<typeof appRouter, { keyPrefix: true }>(appRouter, {
      client,
      keyPrefix: 'blog',
    });
    const queryClient = makeQueryClient();
    expect(rpc(queryClient).post.byId.queryKey({ id: 1 })).toEqual([
      ['blog'],
      ['post', 'byId'],
      { input: { id: 1 }, type: 'query' },
    ]);
  });

  test('createStartHydration alone round-trips class instances', async () => {
    const { rpc, client } = makeHelpers();
    clients.push(client);
    const hydration = createStartHydration(appRouter);
    const serverQc = makeQueryClient();
    await serverQc.ensureQueryData(rpc(serverQc).post.byId.queryOptions({ id: 2 }));
    const browserQc = makeQueryClient();
    hydration.hydrate(browserQc, overTheWire(hydration.dehydrate(serverQc)));
    expect(browserQc.getQueryData(rpc(browserQc).post.byId.queryKey({ id: 2 }))).toBeInstanceOf(
      Post,
    );
  });
});
