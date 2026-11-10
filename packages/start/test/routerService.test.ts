// Every TanStack Start helper takes a router service class: the route handler, the server /
// browser / isomorphic clients and the loader + hydration helpers decode class instances and
// typed errors.
import { Router } from '@rpc-effect/core';
import type { DehydratedState } from '@tanstack/react-query';
import { describe, expect, onTestFinished, test } from 'vite-plus/test';
import {
  createBrowserClient,
  createIsomorphicClient,
  createServerClient,
  createStartHandler,
  createStartHelpers,
  createStartHydration,
} from '../src/index.js';
import { makeQueryClient } from './fixtures.js';
import { AppHandlers, AppRouter, Post, PostNotFound, postCreatedAt } from './service-fixtures.js';

const rejection = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );

const overTheWire = (state: DehydratedState): DehydratedState => JSON.parse(JSON.stringify(state));

describe('TanStack Start helpers with a router service', () => {
  test('createStartHandler + createBrowserClient: instances and typed errors over HTTP', async () => {
    const handler = createStartHandler(AppRouter, { handlers: AppHandlers });
    onTestFinished(() => handler.dispose());
    await using client = createBrowserClient(AppRouter, {
      url: 'http://localhost/api/rpc',
      fetch: (input, init) => handler({ request: new Request(input, init) }),
    });
    expect(client.$router).toBe(Router.from(AppRouter));
    const post = await client.post.byId({ id: 1 });
    expect(post).toBeInstanceOf(Post);
    expect(post.headline()).toBe('#1 Hello');
    expect(await rejection(client.post.byId({ id: 7 }))).toBeInstanceOf(PostNotFound);
  });

  test('createServerClient and createIsomorphicClient (server half)', async () => {
    await using server = createServerClient(AppRouter, { handlers: AppHandlers });
    expect(await server.post.byId({ id: 1 })).toBeInstanceOf(Post);
    await using iso = createIsomorphicClient(AppRouter, {
      server: { handlers: AppHandlers },
      client: { url: 'http://localhost/api/rpc' },
      isServer: true,
    });
    expect(await rejection(iso.post.byId({ id: 7 }))).toBeInstanceOf(PostNotFound);
  });

  test('createStartHelpers + createStartHydration: loader data survives dehydrate / hydrate', async () => {
    await using client = createServerClient(AppRouter, { handlers: AppHandlers });
    const helpers = createStartHelpers(AppRouter, { client });
    const serverQc = makeQueryClient();
    const post = await serverQc.ensureQueryData(
      helpers.rpc(serverQc).post.byId.queryOptions({ id: 1 }),
    );
    expect(post).toBeInstanceOf(Post);
    await serverQc.prefetchQuery(helpers.rpc(serverQc).post.byId.queryOptions({ id: 7 }));

    for (const hydration of [helpers.hydration, createStartHydration(AppRouter)]) {
      const browserQc = makeQueryClient();
      hydration.hydrate(browserQc, overTheWire(hydration.dehydrate(serverQc)));
      const restored = browserQc.getQueryData(helpers.rpc(browserQc).post.byId.queryKey({ id: 1 }));
      expect(restored).toBeInstanceOf(Post);
      expect(restored?.createdAt).toEqual(postCreatedAt);
      const error = browserQc.getQueryState(
        helpers.rpc(browserQc).post.byId.queryKey({ id: 7 }),
      )?.error;
      expect(error).toBeInstanceOf(PostNotFound);
    }
  });
});
