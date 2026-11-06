// @vitest-environment jsdom
// Port of trpc/packages/tanstack-react-query/test/client.test.tsx (useTRPCClient → useRpcClient)
import { render } from '@testing-library/react';
import { act, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, expectTypeOf, test } from 'vite-plus/test';
import { createRpcContext } from '../src/index.js';
import type { AppRouter, Post } from './fixtures.js';
import { testReactResource, waitFor } from './helpers.js';

describe('useRpcClient', () => {
  test('fetch and use the client', async () => {
    await using ctx = await testReactResource();

    function MyComponent() {
      const client = ctx.useRpcClient();
      const [fetched, setFetched] = React.useState('');
      const fetch = async (): Promise<void> => {
        const post = await client.post.byId({ id: 1 });
        expectTypeOf(post).toEqualTypeOf<Post>();
        setFetched(post.shout());
      };
      return (
        <>
          <button data-testid="fetch" onClick={() => void fetch()}>
            fetch
          </button>
          <pre>{`Fetched: ${fetched}`}</pre>
        </>
      );
    }

    const utils = ctx.renderApp(<MyComponent />);
    await act(async () => {
      fireEvent.click(utils.getByTestId('fetch'));
    });
    await waitFor(() => {
      expect(utils.container.querySelector('pre')?.textContent).toBe('Fetched: HELLO WORLD!');
    });
  });

  test('the hooks throw outside of the provider', () => {
    const { useRpc, useRpcClient } = createRpcContext<AppRouter>();
    const UsesRpc = () => {
      useRpc();
      return null;
    };
    const UsesClient = () => {
      useRpcClient();
      return null;
    };
    const original = console.error;
    console.error = () => {};
    try {
      expect(() => render(<UsesRpc />)).toThrow(
        'useRpc() can only be used inside of an <RpcProvider>',
      );
      expect(() => render(<UsesClient />)).toThrow(
        'useRpcClient() can only be used inside of an <RpcProvider>',
      );
    } finally {
      console.error = original;
    }
  });

  test('the options proxy is memoized per provider', async () => {
    await using ctx = await testReactResource();
    const proxies: Array<unknown> = [];

    function MyComponent({ n }: { n: number }) {
      proxies.push(ctx.useRpc());
      return <pre>{n}</pre>;
    }

    const utils = ctx.renderApp(<MyComponent n={1} />);
    ctx.rerenderApp(utils, <MyComponent n={2} />);
    expect(utils.container.textContent).toBe('2');
    expect(proxies).toHaveLength(2);
    expect(proxies[0]).toBe(proxies[1]);
  });
});
