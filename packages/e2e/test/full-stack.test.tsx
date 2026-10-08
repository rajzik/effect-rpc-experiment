// @vitest-environment jsdom
// Root gate R4: core → server (real HTTP) → client → TanStack options proxy → React render,
// including Schema-aware dehydrate/hydrate of class instances and typed errors.
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it } from 'vite-plus/test';
import type { ClientError } from '@effect-trpc/core';
import { RpcDefect, RpcInterrupted, RpcTransportError } from '@effect-trpc/core';
import {
  createHydrationHelpers,
  createRpcContext,
  createRpcOptionsProxy,
} from '@effect-trpc/tanstack-react-query';
import { testServerAndClient, type TestServerAndClient } from '@effect-trpc/test-utils';
import * as React from 'react';
import { appRouter, HandlersLive, NotFound, User, type AppRouter } from './fixtures.js';

const { RpcProvider, useRpc } = createRpcContext<AppRouter>();
const { dehydrate, hydrate, HydrationBoundary } = createHydrationHelpers(appRouter);

function UserView({ id }: { readonly id: string }) {
  const rpc = useRpc();
  const q = useQuery(rpc.user.byId.queryOptions({ id }));
  if (q.error) {
    expectTypeOf(q.error).toEqualTypeOf<ClientError<NotFound>>();
    switch (q.error._tag) {
      case 'NotFound':
        return <p data-testid="error">missing:{q.error.id}</p>;
      default:
        return <p data-testid="error">infra:{q.error._tag}</p>;
    }
  }
  if (!q.data) return <p>loading</p>;
  expectTypeOf(q.data).toEqualTypeOf<User>();
  return (
    <p data-testid="user">
      {q.data.greet()}|{q.data.createdAt.toISOString()}|{String(q.data instanceof User)}
    </p>
  );
}

describe('full stack: HTTP → options proxy → React', () => {
  let ctx: TestServerAndClient<AppRouter>;
  beforeAll(async () => {
    ctx = await testServerAndClient(appRouter, { handlers: HandlersLive });
  });
  afterEach(() => cleanup());
  afterAll(async () => {
    await ctx.dispose();
  });

  const renderWith = (queryClient: QueryClient, ui: React.ReactNode) =>
    render(
      <QueryClientProvider client={queryClient}>
        <RpcProvider client={ctx.client} queryClient={queryClient}>
          {ui}
        </RpcProvider>
      </QueryClientProvider>,
    );

  it('renders a Schema.Class instance fetched over HTTP (method callable, Date restored)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const utils = renderWith(queryClient, <UserView id="ada" />);
    await waitFor(() => expect(utils.getByTestId('user')).toBeTruthy());
    expect(utils.getByTestId('user').textContent).toBe('Hello, Ada!|2026-01-02T03:04:05.000Z|true');
  });

  it('renders a typed TaggedError discriminated by _tag', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const utils = renderWith(queryClient, <UserView id="ghost" />);
    await waitFor(() => expect(utils.getByTestId('error')).toBeTruthy());
    expect(utils.getByTestId('error').textContent).toBe('missing:ghost');
    const state = queryClient.getQueryState(
      createRpcOptionsProxy({ client: ctx.client, queryClient }).user.byId.queryKey({
        id: 'ghost',
      }),
    );
    expect(state?.error).toBeInstanceOf(NotFound);
  });

  it('surfaces a handler defect as RpcDefect, not as a domain error', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rpc = createRpcOptionsProxy({ client: ctx.client, queryClient });
    const error = await queryClient.fetchQuery(rpc.boom.queryOptions()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RpcDefect);
    expect(error).not.toBeInstanceOf(RpcTransportError);
    expect(error).not.toBeInstanceOf(RpcInterrupted);
  });

  it('dehydrates to JSON and hydrates back to a class instance rendered without refetch', async () => {
    // "server": prefetch over real HTTP, dehydrate to a JSON-safe payload
    const serverQc = new QueryClient();
    const rpc = createRpcOptionsProxy({ client: ctx.client, queryClient: serverQc });
    await serverQc.prefetchQuery(rpc.user.byId.queryOptions({ id: 'ssr' }));
    await serverQc.prefetchQuery(rpc.user.byId.queryOptions({ id: 'ghost' }));
    const payload = JSON.parse(JSON.stringify(dehydrate(serverQc))) as ReturnType<typeof dehydrate>;
    const encoded = payload.queries.find((q) => JSON.stringify(q.queryKey).includes('"ssr"'));
    expect(encoded?.state.data).toEqual({
      id: 'ssr',
      name: 'Ada',
      createdAt: '2026-01-02T03:04:05.000Z',
    });

    // "client": a fresh QueryClient that never talks to the network for these keys
    const clientQc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
    });
    const utils = render(
      <QueryClientProvider client={clientQc}>
        <RpcProvider client={ctx.client} queryClient={clientQc}>
          <HydrationBoundary state={payload}>
            <UserView id="ssr" />
            <UserView id="ghost" />
          </HydrationBoundary>
        </RpcProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(utils.getByTestId('user')).toBeTruthy());
    expect(utils.getByTestId('user').textContent).toBe('Hello, Ada!|2026-01-02T03:04:05.000Z|true');
    // hydrated error queries are refetched on mount by TanStack (retryOnMount); the typed error returns
    await waitFor(() => expect(utils.getByTestId('error').textContent).toBe('missing:ghost'));

    // imperative hydrate restores instances too
    const another = new QueryClient();
    hydrate(another, payload);
    const data = another.getQueryData(rpc.user.byId.queryKey({ id: 'ssr' }));
    expect(data).toBeInstanceOf(User);
    expect(another.getQueryState(rpc.user.byId.queryKey({ id: 'ghost' }))?.error).toBeInstanceOf(
      NotFound,
    );
  });
});
