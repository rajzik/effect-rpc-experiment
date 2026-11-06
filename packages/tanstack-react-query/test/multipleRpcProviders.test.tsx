// @vitest-environment jsdom
// Port of trpc/packages/tanstack-react-query/test/multipleTrpcProviders.test.tsx
import { createClient, localLink } from '@effect-trpc/client';
import { query, Router } from '@effect-trpc/core';
import { Handlers } from '@effect-trpc/server';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { cleanup, render } from '@testing-library/react';
import { Effect, Schema } from 'effect';
import * as React from 'react';
import { expect, test } from 'vite-plus/test';
import { createRpcContext } from '../src/index.js';
import { waitFor } from './helpers.js';

test('recipe: multiple rpc providers with query key prefixing', async () => {
  const billingRouter = Router.make({ list: query({ success: Schema.Array(Schema.String) }) });
  const accountRouter = Router.make({ list: query({ success: Schema.Array(Schema.String) }) });
  type BillingRouter = typeof billingRouter;
  type AccountRouter = typeof accountRouter;

  const billingClient = createClient(billingRouter, {
    link: localLink({
      handlers: Handlers.make(billingRouter, { list: () => Effect.succeed(['invoice 1']) }),
    }),
  });
  const accountClient = createClient(accountRouter, {
    link: localLink({
      handlers: Handlers.make(accountRouter, { list: () => Effect.succeed(['account 1']) }),
    }),
  });

  const billing = createRpcContext<BillingRouter, { keyPrefix: true }>();
  const account = createRpcContext<AccountRouter, { keyPrefix: true }>();
  const queryClient = new QueryClient();

  function MyComponent() {
    const billingRpc = billing.useRpc();
    const accountRpc = account.useRpc();
    const billingList = useQuery(billingRpc.list.queryOptions());
    const accountList = useQuery(accountRpc.list.queryOptions());
    return (
      <div>
        <div>{`Billing: ${billingList.data?.join(', ') ?? ''}`}</div>
        <div>{`Account: ${accountList.data?.join(', ') ?? ''}`}</div>
      </div>
    );
  }

  function App() {
    return (
      <QueryClientProvider client={queryClient}>
        <billing.RpcProvider client={billingClient} queryClient={queryClient} keyPrefix="billing">
          <account.RpcProvider client={accountClient} queryClient={queryClient} keyPrefix="account">
            <MyComponent />
          </account.RpcProvider>
        </billing.RpcProvider>
      </QueryClientProvider>
    );
  }

  const utils = render(<App />);
  try {
    await waitFor(() => {
      expect(utils.container.textContent).toContain('Billing: invoice 1');
      expect(utils.container.textContent).toContain('Account: account 1');
    });
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey),
    ).toEqual([
      [['billing'], ['list'], { type: 'query' }],
      [['account'], ['list'], { type: 'query' }],
    ]);
    // invalidating one prefix leaves the other alone
    await queryClient.invalidateQueries({ queryKey: [['billing']], refetchType: 'none' });
    expect(
      queryClient.getQueryState([['billing'], ['list'], { type: 'query' }])?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState([['account'], ['list'], { type: 'query' }])?.isInvalidated,
    ).toBe(false);
  } finally {
    cleanup();
    queryClient.clear();
    await billingClient.dispose();
    await accountClient.dispose();
  }
});
