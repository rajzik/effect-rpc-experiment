// @vitest-environment jsdom
// Regression for issue #23: an explicit `initialCursor` (null included) overrides the input's
// cursor; only an omitted one falls back to it.
import { describe, expect, test } from 'vite-plus/test';
import { testReactResource } from './helpers.js';

describe('initialCursor', () => {
  test('an explicit null overrides the input cursor', async () => {
    await using ctx = await testReactResource();
    const options = ctx.optionsProxy.post.list.infiniteQueryOptions(
      { cursor: 2, limit: 1 },
      { initialCursor: null, getNextPageParam: (lastPage) => lastPage.nextCursor },
    );
    const data = await ctx.queryClient.fetchInfiniteQuery(options);
    expect(ctx.state.listCalls).toEqual([{ cursor: null, limit: 1 }]);
    expect(data.pageParams).toEqual([null]);
  });

  test('an explicit 0 overrides the input cursor', async () => {
    await using ctx = await testReactResource();
    const options = ctx.optionsProxy.post.list.infiniteQueryOptions(
      { cursor: 2, limit: 1 },
      { initialCursor: 0, getNextPageParam: (lastPage) => lastPage.nextCursor },
    );
    const data = await ctx.queryClient.fetchInfiniteQuery(options);
    expect(ctx.state.listCalls).toEqual([{ cursor: 0, limit: 1 }]);
    expect(data.pageParams).toEqual([0]);
  });
});
