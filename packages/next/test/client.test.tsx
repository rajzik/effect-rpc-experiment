// @vitest-environment jsdom
// Client side: `useServerAction` (tRPC `next/src/app-dir/{client,procedureErrors}.test.tsx`) and the
// `createNextRpcClient` provider (tRPC's `trpc/client.tsx`) talking to the route handler.
import { useQuery } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { Exit } from 'effect';
import * as React from 'react';
import { afterEach, describe, expect, test } from 'vite-plus/test';
import {
  createNextRpcClient,
  createRouteHandler,
  createRscHelpers,
  createServerActionCaller,
  getBaseUrl,
  makeQueryClient,
  useServerAction,
} from '../src/index.js';
import { appRouter, Forbidden, makeFixture, Post } from './fixtures.js';

afterEach(cleanup);

describe('useServerAction', () => {
  test('success: data is a Post instance', async () => {
    const fixture = makeFixture();
    const actions = createServerActionCaller(appRouter, { handlers: fixture.handlers });
    const createPost = actions('post.create');
    const { result } = renderHook(() =>
      useServerAction(createPost, { router: appRouter, path: 'post.create' }),
    );
    expect(result.current.status).toBe('idle');
    let exit: Exit.Exit<Post, unknown> | undefined;
    await act(async () => {
      exit = await result.current.run({ title: 'from a form' });
    });
    expect(exit !== undefined && Exit.isSuccess(exit)).toBe(true);
    expect(result.current.status).toBe('success');
    expect(result.current.data).toBeInstanceOf(Post);
    expect(result.current.data?.shout()).toBe('FROM A FORM!');
    expect(result.current.error).toBeNull();
    act(() => result.current.reset());
    expect(result.current.status).toBe('idle');
    expect(result.current.data).toBeUndefined();
    await actions.dispose();
  });

  test('typed error: error is the Forbidden instance (the error union is typed)', async () => {
    const fixture = makeFixture();
    const actions = createServerActionCaller(appRouter, { handlers: fixture.handlers });
    const createPost = actions('post.create');
    const Form = (): React.ReactElement => {
      const create = useServerAction(createPost, { router: appRouter, path: 'post.create' });
      const error = create.error;
      return (
        <div>
          <button type="button" onClick={() => void create.run({ title: 'forbidden' })}>
            create
          </button>
          <p>status: {create.status}</p>
          {error?._tag === 'Forbidden' && <p>forbidden because {error.reason}</p>}
        </div>
      );
    };
    render(<Form />);
    act(() => screen.getByText('create').click());
    expect(await screen.findByText('forbidden because no')).toBeDefined();
    expect(screen.getByText('status: error')).toBeDefined();
    await actions.dispose();
  });

  test('a failing action request surfaces as RpcTransportError', async () => {
    const fixture = makeFixture();
    const actions = createServerActionCaller(appRouter, { handlers: fixture.handlers });
    const real = actions('post.create');
    const broken: typeof real = () => Promise.reject(new TypeError('Failed to fetch'));
    const { result } = renderHook(() =>
      useServerAction(broken, { router: appRouter, path: 'post.create' }),
    );
    await act(async () => {
      await result.current.run({ title: 'x' });
    });
    expect(result.current.error?._tag).toBe('@effect-trpc/RpcTransportError');
    expect(result.current.error).not.toBeInstanceOf(Forbidden);
    await actions.dispose();
  });
});

describe('createNextRpcClient', () => {
  test('getBaseUrl() is the page origin in the browser', () => {
    expect(getBaseUrl()).toBe(window.location.origin);
  });

  test('RpcProvider + useRpc query the route handler over httpLink, with class instances', async () => {
    const fixture = makeFixture();
    await using route = createRouteHandler(appRouter, { handlers: fixture.handlers });
    const { RpcProvider, useRpc } = createNextRpcClient(appRouter, {
      url: '/api/rpc',
      fetch: (input, init) => {
        const request = new Request(input, init);
        expect(new URL(request.url).origin).toBe(window.location.origin);
        return route.POST(request);
      },
    });
    const PostView = (): React.ReactElement => {
      const rpc = useRpc();
      const { data, error } = useQuery(rpc.post.byId.queryOptions({ id: 1 }));
      if (error !== null) return <p>error {error._tag}</p>;
      return (
        <p>{data === undefined ? 'loading' : `${data.shout()} ${String(data instanceof Post)}`}</p>
      );
    };
    render(
      <RpcProvider>
        <PostView />
      </RpcProvider>,
    );
    expect(await screen.findByText('HELLO WORLD! true')).toBeDefined();
  });

  test('server prefetch → HydrateClient → client provider: no client fetch, Post instance', async () => {
    const fixture = makeFixture();
    let clientFetches = 0;
    const { RpcProvider, useRpc, HydrationBoundary } = createNextRpcClient(appRouter, {
      fetch: () => {
        clientFetches++;
        return Promise.resolve(new Response(null, { status: 500 }));
      },
    });
    // "server.tsx", with the client module's HydrationBoundary
    const server = createRscHelpers(
      appRouter,
      { handlers: fixture.handlers },
      {
        HydrationBoundary,
        cache: (fn) => {
          let v: ReturnType<typeof fn> | undefined;
          return () => (v ??= fn());
        },
      },
    );
    server.prefetch(server.rpc.post.byId.queryOptions({ id: 2 }));
    await waitFor(() => {
      expect(server.getQueryClient().isFetching()).toBe(0);
    });
    const PostView = (): React.ReactElement => {
      const rpc = useRpc();
      const { data } = useQuery(rpc.post.byId.queryOptions({ id: 2 }));
      return <p>{data instanceof Post ? data.shout() : 'loading'}</p>;
    };
    render(
      <RpcProvider queryClient={makeQueryClient()}>
        <server.HydrateClient>
          <PostView />
        </server.HydrateClient>
      </RpcProvider>,
    );
    expect(await screen.findByText('POST 2!')).toBeDefined();
    expect(clientFetches).toBe(0);
    await server.client.dispose();
  });

  test('getQueryClient() is a browser singleton', () => {
    const { getQueryClient } = createNextRpcClient(appRouter);
    expect(getQueryClient()).toBe(getQueryClient());
  });
});
