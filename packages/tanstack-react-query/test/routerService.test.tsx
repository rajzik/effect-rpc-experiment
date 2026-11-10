// @vitest-environment jsdom
// A router service class works with the options proxy, the typed context and the hydration
// helpers: query results are class instances and typed errors, also after dehydrate / hydrate.
import { createClient, localLink } from '@rpc-effect/client';
import { QueryClientProvider, useQuery, type DehydratedState } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
  createHydrationHelpers,
  createRpcContext,
  createRpcOptionsProxy,
  dehydrate,
  hydrate,
} from '../src/index.js';
import { makeQueryClient } from './helpers.js';
import { AppHandlers, AppRouter, Post, PostNotFound, postCreatedAt } from './service-fixtures.js';

afterEach(cleanup);

const makeClient = () => createClient(AppRouter, { link: localLink({ handlers: AppHandlers }) });

describe('a router service with TanStack Query', () => {
  it('createRpcOptionsProxy: query options decode instances and typed errors', async () => {
    await using client = makeClient();
    const queryClient = makeQueryClient();
    const rpc = createRpcOptionsProxy({ client, queryClient });
    const post = await queryClient.fetchQuery(rpc.post.byId.queryOptions({ id: 1 }));
    expect(post).toBeInstanceOf(Post);
    expect(post.headline()).toBe('#1 Hello');
    const missing = await queryClient
      .fetchQuery(rpc.post.byId.queryOptions({ id: 7 }))
      .catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(PostNotFound);
  });

  it('createRpcContext<typeof Svc>: useRpc() options in a component', async () => {
    await using client = makeClient();
    const queryClient = makeQueryClient();
    const { RpcProvider, useRpc } = createRpcContext<typeof AppRouter>();
    const Title = () => {
      const rpc = useRpc();
      const { data } = useQuery(rpc.post.byId.queryOptions({ id: 1 }));
      return (
        <p>
          {data === undefined ? 'loading' : `${data.headline()} ${String(data instanceof Post)}`}
        </p>
      );
    };
    const view = render(
      <QueryClientProvider client={queryClient}>
        <RpcProvider client={client} queryClient={queryClient}>
          <Title />
        </RpcProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(view.container.textContent).toBe('#1 Hello true'));
  });

  it('createHydrationHelpers, dehydrate and hydrate restore instances and typed errors', async () => {
    await using client = makeClient();
    const server = makeQueryClient();
    const rpc = createRpcOptionsProxy({ client, queryClient: server });
    await server.prefetchQuery(rpc.post.byId.queryOptions({ id: 1 }));
    await server.prefetchQuery(rpc.post.byId.queryOptions({ id: 7 }));

    const helpers = createHydrationHelpers(AppRouter);
    const states: ReadonlyArray<DehydratedState> = [
      JSON.parse(JSON.stringify(helpers.dehydrate(server))),
      JSON.parse(JSON.stringify(dehydrate(AppRouter, server))),
    ];
    for (const [index, state] of states.entries()) {
      const browser = makeQueryClient();
      if (index === 0) helpers.hydrate(browser, state);
      else hydrate(AppRouter, browser, state);
      const post = browser.getQueryData(rpc.post.byId.queryKey({ id: 1 }));
      expect(post).toBeInstanceOf(Post);
      expect(post?.createdAt).toEqual(postCreatedAt);
      const error = browser.getQueryState(rpc.post.byId.queryKey({ id: 7 }))?.error;
      expect(error).toBeInstanceOf(PostNotFound);
    }
  });
});
