// Query keys hold the input encoded with the procedure's JSON payload codec, so that TanStack's
// JSON hashing tells `Set` / `Map` inputs apart and accepts `bigint` inputs (issue #14).
import { query, Router, subscription } from '@rpc-effect/core';
import { Handlers } from '@rpc-effect/server';
import { testServerAndClient } from '@rpc-effect/test-utils';
import { hashKey, type DehydratedState } from '@tanstack/react-query';
import { Effect, Schema, Stream } from 'effect';
import { describe, expect, test } from 'vite-plus/test';
import { createHydrationHelpers, createRpcOptionsProxy } from '../src/index.js';
import { makeQueryClient } from './helpers.js';

const router = Router.make({
  search: query({
    payload: {
      tags: Schema.ReadonlySet(Schema.String),
      weights: Schema.ReadonlyMap(Schema.String, Schema.Finite),
    },
    success: Schema.String,
  }),
  lookup: query({ payload: { id: Schema.BigInt }, success: Schema.String }),
  feed: query({
    payload: {
      tags: Schema.ReadonlySet(Schema.String),
      cursor: Schema.optional(Schema.NullOr(Schema.Finite)),
    },
    success: Schema.String,
  }),
  watch: subscription({ payload: { id: Schema.BigInt }, success: Schema.String }),
});

const handlers = Handlers.make(router, {
  search: ({ tags, weights }) => Effect.succeed(JSON.stringify([[...tags], [...weights]])),
  lookup: ({ id }) => Effect.succeed(`${typeof id}:${id}`),
  feed: ({ tags, cursor }) => Effect.succeed(`${[...tags].join()}@${cursor ?? 0}`),
  watch: ({ id }) => Stream.make(`${typeof id}:${id}`),
});

const setup = async () => {
  const server = await testServerAndClient(router, { handlers });
  const queryClient = makeQueryClient();
  const rpc = createRpcOptionsProxy({ client: server.client, queryClient });
  return {
    rpc,
    queryClient,
    [Symbol.asyncDispose]: async () => {
      queryClient.clear();
      await server.dispose();
    },
  };
};

const search = (
  tags: ReadonlyArray<string>,
  weights: ReadonlyArray<readonly [string, number]>,
) => ({
  tags: new Set(tags),
  weights: new Map(weights),
});

describe('structured inputs in query keys', () => {
  test('distinct Set and Map inputs get distinct cache entries', async () => {
    await using ctx = await setup();
    const { rpc, queryClient } = ctx;
    const fetch = (input: ReturnType<typeof search>) =>
      queryClient.fetchQuery({ ...rpc.search.queryOptions(input), staleTime: Infinity });

    expect(await fetch(search(['first'], [['a', 1]]))).toBe('[["first"],[["a",1]]]');
    expect(await fetch(search(['second'], [['a', 1]]))).toBe('[["second"],[["a",1]]]');
    expect(await fetch(search(['first'], [['a', 2]]))).toBe('[["first"],[["a",2]]]');

    expect(queryClient.getQueryData(rpc.search.queryKey(search(['second'], [['a', 1]])))).toBe(
      '[["second"],[["a",1]]]',
    );
    expect(rpc.search.queryKey(search(['first'], [['a', 1]]))).toEqual([
      ['search'],
      { input: { tags: ['first'], weights: [['a', 1]] }, type: 'query' },
    ]);
  });

  test('filters match by the encoded input, also with a partial input', async () => {
    await using ctx = await setup();
    const { rpc, queryClient } = ctx;
    await queryClient.prefetchQuery(rpc.search.queryOptions(search(['first'], [['a', 1]])));
    await queryClient.prefetchQuery(rpc.search.queryOptions(search(['second'], [['a', 1]])));

    await queryClient.invalidateQueries({
      ...rpc.search.queryFilter({ tags: new Set(['first']) }),
      refetchType: 'none',
    });
    const invalidated = (tags: ReadonlyArray<string>) =>
      queryClient.getQueryState(rpc.search.queryKey(search(tags, [['a', 1]])))?.isInvalidated;
    expect(invalidated(['first'])).toBe(true);
    expect(invalidated(['second'])).toBe(false);
  });

  test('bigint inputs work through queryOptions and the query client', async () => {
    await using ctx = await setup();
    const { rpc, queryClient } = ctx;

    expect(await queryClient.fetchQuery(rpc.lookup.queryOptions({ id: 1n }))).toBe('bigint:1');
    expect(queryClient.getQueryData(rpc.lookup.queryKey({ id: 1n }))).toBe('bigint:1');
    expect(rpc.lookup.queryKey({ id: 1n })).toEqual([
      ['lookup'],
      { input: { id: '1' }, type: 'query' },
    ]);

    await queryClient.invalidateQueries({
      ...rpc.lookup.queryFilter({ id: 1n }, { exact: true }),
      refetchType: 'none',
    });
    expect(queryClient.getQueryState(rpc.lookup.queryKey({ id: 1n }))?.isInvalidated).toBe(true);
  });

  test('infinite keys encode the input and drop the cursor', async () => {
    await using ctx = await setup();
    const { rpc, queryClient } = ctx;
    const fetch = (tags: ReadonlyArray<string>) =>
      queryClient.fetchInfiniteQuery({
        ...rpc.feed.infiniteQueryOptions({ tags: new Set(tags) }, { getNextPageParam: () => null }),
        staleTime: Infinity,
      });

    expect((await fetch(['first'])).pages).toEqual(['first@0']);
    expect((await fetch(['second'])).pages).toEqual(['second@0']);
    expect(rpc.feed.infiniteQueryKey({ tags: new Set(['first']), cursor: 3 })).toEqual([
      ['feed'],
      { input: { tags: ['first'] }, type: 'infinite' },
    ]);
  });

  test('subscription keys encode the input; the stream gets the decoded input', async () => {
    await using ctx = await setup();
    const options = ctx.rpc.watch.subscriptionOptions({ id: 7n });
    expect(options.queryKey).toEqual([['watch'], { input: { id: '7' } }]);
    expect(hashKey(options.queryKey)).not.toBe(
      hashKey(ctx.rpc.watch.subscriptionOptions({ id: 8n }).queryKey),
    );

    const data = await new Promise((resolve, reject) => {
      options.subscribe({ onData: resolve, onError: reject });
    });
    expect(data).toBe('bigint:7');
  });

  test('hydration keeps the encoded keys through JSON', async () => {
    await using ctx = await setup();
    const { rpc, queryClient } = ctx;
    const helpers = createHydrationHelpers(router);
    await queryClient.prefetchQuery(rpc.lookup.queryOptions({ id: 1n }));
    await queryClient.prefetchQuery(rpc.search.queryOptions(search(['first'], [])));
    const state: DehydratedState = JSON.parse(JSON.stringify(helpers.dehydrate(queryClient)));

    const browser = makeQueryClient();
    helpers.hydrate(browser, state);
    expect(browser.getQueryData(rpc.lookup.queryKey({ id: 1n }))).toBe('bigint:1');
    expect(browser.getQueryData(rpc.search.queryKey(search(['first'], [])))).toBe('[["first"],[]]');
    expect(browser.getQueryData(rpc.search.queryKey(search(['second'], [])))).toBeUndefined();
    browser.clear();
  });
});
