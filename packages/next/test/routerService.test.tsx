// @vitest-environment jsdom
// Every Next.js helper takes a router service class: route handler, browser client, RSC helpers
// and server actions decode class instances and typed errors.
import { Router } from '@rpc-effect/core';
import { useQuery } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Exit } from 'effect';
import * as React from 'react';
import { afterEach, describe, expect, onTestFinished, test } from 'vite-plus/test';
import {
  createNextRpcClient,
  createRouteHandler,
  createRscHelpers,
  createServerActionCaller,
  decodeActionResult,
  makeQueryClient,
  unwrapActionResult,
  useServerAction,
} from '../src/index.js';
import { AppHandlers, AppRouter, Post, PostNotFound, postCreatedAt } from './service-fixtures.js';

afterEach(cleanup);

const overTheWire = <A,>(value: A): A => JSON.parse(JSON.stringify(value));

/** A stable query client per "request" (`React.cache` only memoizes inside RSC). */
const cache = <T,>(fn: () => T): (() => T) => {
  let value: { readonly current: T } | undefined;
  return () => (value ??= { current: fn() }).current;
};

describe('Next.js helpers with a router service', () => {
  test('createRouteHandler + createNextRpcClient: instances over HTTP', async () => {
    await using route = createRouteHandler(AppRouter, { handlers: AppHandlers });
    const { RpcProvider, useRpc } = createNextRpcClient(AppRouter, {
      fetch: (input, init) => route.POST(new Request(input, init)),
    });
    const View = (): React.ReactElement => {
      const rpc = useRpc();
      const post = useQuery(rpc.post.byId.queryOptions({ id: 1 }));
      const missing = useQuery({ ...rpc.post.byId.queryOptions({ id: 7 }), retry: false });
      return (
        <p>
          {post.data instanceof Post ? post.data.headline() : 'loading'}/
          {missing.error instanceof PostNotFound ? missing.error._tag : 'pending'}
        </p>
      );
    };
    render(
      <RpcProvider>
        <View />
      </RpcProvider>,
    );
    expect(await screen.findByText('#1 Hello/PostNotFound')).toBeDefined();
  });

  test('createRscHelpers: caller, prefetch and HydrateClient keep instances', async () => {
    const { RpcProvider, useRpc, HydrationBoundary } = createNextRpcClient(AppRouter);
    const server = createRscHelpers(
      AppRouter,
      { handlers: AppHandlers },
      { HydrationBoundary, cache },
    );
    expect(server.client.$router).toBe(Router.from(AppRouter));
    const post = await server.caller.$promise.post.byId({ id: 1 });
    expect(post).toBeInstanceOf(Post);
    expect(
      await server.caller.$promise.post.byId({ id: 7 }).catch((e: unknown) => e),
    ).toBeInstanceOf(PostNotFound);
    server.prefetch(server.rpc.post.byId.queryOptions({ id: 1 }));
    await waitFor(() => expect(server.getQueryClient().isFetching()).toBe(0));
    const View = (): React.ReactElement => {
      const rpc = useRpc();
      const { data } = useQuery({ ...rpc.post.byId.queryOptions({ id: 1 }), enabled: false });
      return <p>{data instanceof Post ? data.createdAt.toISOString() : 'missing'}</p>;
    };
    render(
      <RpcProvider queryClient={makeQueryClient()}>
        <server.HydrateClient>
          <View />
        </server.HydrateClient>
      </RpcProvider>,
    );
    expect(await screen.findByText(postCreatedAt.toISOString())).toBeDefined();
    await server.client.dispose();
  });

  test('createServerActionCaller, decodeActionResult, unwrapActionResult and useServerAction', async () => {
    const actions = createServerActionCaller(AppRouter, { handlers: AppHandlers });
    onTestFinished(() => actions.dispose());
    const exit = decodeActionResult(
      AppRouter,
      'post.byId',
      overTheWire(await actions('post.byId')({ id: 1 })),
    );
    expect(Exit.isSuccess(exit) ? exit.value : undefined).toBeInstanceOf(Post);
    const failed = decodeActionResult(
      AppRouter,
      'post.byId',
      overTheWire(await actions('post.byId')({ id: 7 })),
    );
    expect(Exit.isFailure(failed)).toBe(true);
    const post = await unwrapActionResult(
      AppRouter,
      'post.byId',
      actions.nested.post.byId({ id: 1 }),
    );
    expect(post.headline()).toBe('#1 Hello');
    expect(
      await unwrapActionResult(AppRouter, 'post.byId', actions('post.byId')({ id: 7 })).catch(
        (e: unknown) => e,
      ),
    ).toBeInstanceOf(PostNotFound);

    const byId = actions('post.byId');
    const View = (): React.ReactElement => {
      const action = useServerAction(byId, { router: AppRouter, path: 'post.byId' });
      React.useEffect(() => {
        void action.run({ id: 1 });
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
      }, []);
      return <p>{action.data instanceof Post ? action.data.headline() : action.status}</p>;
    };
    render(<View />);
    expect(await screen.findByText('#1 Hello')).toBeDefined();
  });
});
