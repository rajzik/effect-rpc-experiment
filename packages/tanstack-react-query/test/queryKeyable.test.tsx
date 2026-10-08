// @vitest-environment jsdom
// Port of trpc/packages/tanstack-react-query/test/queryKeyable.test.tsx
import { createClient, localLink } from '@effect-trpc/client';
import type { ClientError } from '@effect-trpc/core';
import { QueryClient, type QueryFilters } from '@tanstack/react-query';
import * as React from 'react';
import { describe, expect, expectTypeOf, test } from 'vite-plus/test';
import {
  createRpcContext,
  type AnyRpcQueryKey,
  type RpcMutationKeyWithoutPrefix,
  type RpcMutationKeyWithPrefix,
  type RpcQueryKeyWithoutPrefix,
  type RpcQueryKeyWithPrefix,
} from '../src/index.js';
import {
  appRouter,
  makeFixture,
  makePost,
  type AppRouter,
  type Forbidden,
  type Post,
  type PostNotFound,
} from './fixtures.js';
import { testReactResource } from './helpers.js';

describe('query filters', () => {
  test('gets various query filters', async () => {
    await using ctx = await testReactResource();
    const rpc = ctx.optionsProxy;
    expect(rpc.pathFilter()).toEqual({ queryKey: [] });
    expect(rpc.post.pathFilter()).toEqual({ queryKey: [['post']] });
    expect(rpc.post.byId.pathFilter()).toEqual({ queryKey: [['post', 'byId']] });
    expect(rpc.post.byId.queryFilter({ id: 1 })).toEqual({
      queryKey: [['post', 'byId'], { input: { id: 1 }, type: 'query' }],
    });
    expect(rpc.post.byId.queryFilter(undefined, { stale: true })).toEqual({
      stale: true,
      queryKey: [['post', 'byId'], { type: 'query' }],
    });
  });

  test('type inference for query filters', async () => {
    await using ctx = await testReactResource();
    const rpc = ctx.optionsProxy;
    const filter = rpc.post.byId.queryFilter(
      { id: 1 },
      {
        predicate: (query) => {
          expectTypeOf(query.queryKey).toExtend<ReadonlyArray<unknown>>();
          return true;
        },
      },
    );
    expectTypeOf(filter.queryKey).toExtend<AnyRpcQueryKey>();
    const data = ctx.queryClient.getQueryData(filter.queryKey);
    expectTypeOf(data).toEqualTypeOf<Post | undefined>();
  });

  test('filters match the cached queries (invalidation by path)', async () => {
    await using ctx = await testReactResource();
    const { queryClient, optionsProxy: rpc } = ctx;
    await queryClient.fetchQuery(rpc.post.byId.queryOptions({ id: 1 }));
    await queryClient.fetchQuery(rpc.post.byId.queryOptions({ id: 2 }));
    await queryClient.fetchQuery(rpc.health.queryOptions());
    queryClient.setQueryData(['unrelated'], 1);
    const count = (filter: QueryFilters<any>) => queryClient.getQueryCache().findAll(filter).length;
    expect(count(rpc.post.byId.queryFilter({ id: 1 }))).toBe(1);
    expect(count(rpc.post.byId.queryFilter())).toBe(2);
    expect(count(rpc.post.pathFilter())).toBe(2);
    expect(count(rpc.pathFilter())).toBe(4);
    await queryClient.invalidateQueries({ ...rpc.post.pathFilter(), refetchType: 'none' });
    expect(queryClient.getQueryState(rpc.post.byId.queryKey({ id: 1 }))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(rpc.health.queryKey())?.isInvalidated).toBe(false);
  });
});

describe('query keys', () => {
  test('gets various query keys', async () => {
    await using ctx = await testReactResource();
    const rpc = ctx.optionsProxy;
    expect(rpc.pathKey()).toEqual([]);
    expect(rpc.post.pathKey()).toEqual([['post']]);
    expect(rpc.post.byId.pathKey()).toEqual([['post', 'byId']]);
    expect(rpc.post.byId.queryKey({ id: 1 })).toEqual([
      ['post', 'byId'],
      { input: { id: 1 }, type: 'query' },
    ]);
    expect(rpc.post.list.infiniteQueryKey({ cursor: 3, limit: 2 })).toEqual([
      ['post', 'list'],
      { input: { limit: 2 }, type: 'infinite' },
    ]);
    expect(rpc.events.subscriptionOptions({ offset: 1 }).queryKey).toEqual([
      ['events'],
      { input: { offset: 1 } },
    ]);
  });

  test('type inference for query keys (data tags)', async () => {
    await using ctx = await testReactResource();
    const rpc = ctx.optionsProxy;
    const post = makePost(9);
    const previous = ctx.queryClient.setQueryData(rpc.post.byId.queryKey({ id: 9 }), post);
    expectTypeOf(previous).toEqualTypeOf<Post | undefined>();
    const cached = ctx.queryClient.getQueryData(rpc.post.byId.queryKey({ id: 9 }));
    expectTypeOf(cached).toEqualTypeOf<Post | undefined>();
    expect(cached).toBe(post);
    // the options' key is tagged as well
    const viaOptions = ctx.queryClient.getQueryData(rpc.post.byId.queryOptions({ id: 9 }).queryKey);
    expectTypeOf(viaOptions).toEqualTypeOf<Post | undefined>();
    expect(viaOptions).toBe(post);
  });

  test('type inference for getQueryState', async () => {
    await using ctx = await testReactResource();
    const rpc = ctx.optionsProxy;
    await ctx.queryClient
      .fetchQuery(rpc.post.byId.queryOptions({ id: 404 }))
      .catch(() => undefined);
    const state = ctx.queryClient.getQueryState(rpc.post.byId.queryKey({ id: 404 }));
    expectTypeOf(state?.data).toEqualTypeOf<Post | undefined>();
    expectTypeOf(state?.error).toEqualTypeOf<
      ClientError<PostNotFound | Forbidden> | null | undefined
    >();
    expect(state?.error?._tag).toBe('PostNotFound');
  });
});

describe('query keys with a prefix', () => {
  test('gets various query keys', async () => {
    await using ctx = await testReactResource({ keyPrefix: 'user-123' });
    const rpc = ctx.optionsProxy;
    expect(rpc.pathKey()).toEqual([['user-123']]);
    expect(rpc.post.pathKey()).toEqual([['user-123'], ['post']]);
    expect(rpc.post.byId.pathKey()).toEqual([['user-123'], ['post', 'byId']]);
    expect(rpc.post.byId.queryKey({ id: 1 })).toEqual([
      ['user-123'],
      ['post', 'byId'],
      { input: { id: 1 }, type: 'query' },
    ]);
    expect(rpc.post.byId.queryOptions({ id: 1 }).queryKey).toEqual(
      rpc.post.byId.queryKey({ id: 1 }),
    );
  });
});

describe('mutation keys', () => {
  test('gets various mutation keys', async () => {
    await using ctx = await testReactResource();
    const rpc = ctx.optionsProxy;
    // @ts-expect-error - not a mutation
    void rpc.post.byId.mutationKey;
    // @ts-expect-error - not a mutation
    void rpc.post.mutationKey;
    expect(rpc.post.create.mutationKey()).toEqual([['post', 'create']]);
  });

  test('gets various mutation keys with a prefix', async () => {
    await using ctx = await testReactResource({ keyPrefix: 'user-123' });
    const rpc = ctx.optionsProxy;
    expect(rpc.post.create.mutationKey()).toEqual([['user-123'], ['post', 'create']]);
    expect(rpc.post.create.mutationOptions().mutationKey).toEqual([
      ['user-123'],
      ['post', 'create'],
    ]);
  });
});

test('key types with and without prefix', async () => {
  {
    await using ctx = await testReactResource({ keyPrefix: 'user-123' });
    const key = ctx.optionsProxy.health.pathKey();
    expectTypeOf(key).toEqualTypeOf<RpcQueryKeyWithPrefix>();
    expect(key).toEqual([['user-123'], ['health']]);
    const mutationKey = ctx.optionsProxy.post.reset.mutationKey();
    expectTypeOf(mutationKey).toEqualTypeOf<RpcMutationKeyWithPrefix>();
    expect(mutationKey).toEqual([['user-123'], ['post', 'reset']]);
  }
  {
    await using ctx = await testReactResource();
    const key = ctx.optionsProxy.health.pathKey();
    expectTypeOf(key).toEqualTypeOf<RpcQueryKeyWithoutPrefix>();
    expect(key).toEqual([['health']]);
    const mutationKey = ctx.optionsProxy.post.reset.mutationKey();
    expectTypeOf(mutationKey).toEqualTypeOf<RpcMutationKeyWithoutPrefix>();
    expect(mutationKey).toEqual([['post', 'reset']]);
  }
});

test('types of normal usage: keyPrefix is required exactly with the keyPrefix flag', () => {
  const client = createClient(appRouter, {
    link: localLink({ handlers: makeFixture().handlers }),
  });
  const queryClient = new QueryClient();
  const plain = createRpcContext<AppRouter>();
  const prefixed = createRpcContext<AppRouter, { keyPrefix: true }>();
  const elements = [
    <plain.RpcProvider key="1" client={client} queryClient={queryClient} />,
    // @ts-expect-error - keyPrefix needs the `{ keyPrefix: true }` flag
    <plain.RpcProvider key="2" client={client} queryClient={queryClient} keyPrefix="test" />,
    // @ts-expect-error - keyPrefix is required with the flag
    <prefixed.RpcProvider key="3" client={client} queryClient={queryClient} />,
    <prefixed.RpcProvider key="4" client={client} queryClient={queryClient} keyPrefix="test" />,
  ];
  expect(elements).toHaveLength(4);
  void client.dispose();
});

test('options for the wrong procedure kind throw a helpful error', async () => {
  await using ctx = await testReactResource();
  const rpc = ctx.optionsProxy as any;
  expect(() => rpc.post.create.queryOptions({ title: 'x' })).toThrow(
    '"post.create" is a mutation; use mutationOptions() instead',
  );
  expect(() => rpc.post.nope.queryOptions()).toThrow('"post.nope" is not a procedure');
  expect(() => rpc.post()).toThrow('is not callable');
  // the proxy is not thenable
  expect(rpc.then).toBeUndefined();
});
