// @vitest-environment jsdom
// Port of trpc/packages/tanstack-react-query/test/skipToken.test.tsx
import { skipToken, useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { describe, expect, test } from 'vite-plus/test';
import { useSubscription } from '../src/index.js';
import { testReactResource, waitFor } from './helpers.js';

describe('skipToken', () => {
  test('various methods honour the skipToken', async () => {
    await using ctx = await testReactResource();

    function MyComponent() {
      const rpc = ctx.useRpc();
      const options = rpc.post.byId.queryOptions(skipToken);
      expect(options.queryFn).toBe(skipToken);
      const options2 = rpc.post.list.infiniteQueryOptions(skipToken, {
        getNextPageParam: (page) => page.nextCursor,
      });
      expect(options2.queryFn).toBe(skipToken);
      // the key has no input
      expect(options.queryKey).toEqual([['post', 'byId'], { type: 'query' }]);
      const query = useQuery(options);
      return <pre>{`OK:${query.fetchStatus}`}</pre>;
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('OK:idle');
    });
  });

  test('subscriptionOptions(skipToken).enabled is false; normal input is enabled', async () => {
    await using ctx = await testReactResource();

    function MyComponent() {
      const rpc = ctx.useRpc();
      const skipped = rpc.events.subscriptionOptions(skipToken, {});
      expect(skipped.enabled).toBe(false);
      const active = rpc.events.subscriptionOptions({ offset: 42 }, {});
      expect(active.enabled).toBe(true);
      const forcedOff = rpc.events.subscriptionOptions({ offset: 42 }, { enabled: false });
      expect(forcedOff.enabled).toBe(false);
      const result = useSubscription(skipped);
      return <pre>{result.status}</pre>;
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('idle');
    });
    expect(ctx.listenerCount()).toBe(0);
  });
});
