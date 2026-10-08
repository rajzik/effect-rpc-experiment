// The README's TanStack Start wiring, run through real `@tanstack/react-router` objects: the
// server route handler, a route loader with `ensureQueryData`, and the router-level SSR
// dehydrate → hydrate of the QueryClient.
import { afterAll, describe, expect, test } from 'vite-plus/test';
import {
  client,
  describeError,
  DraftRoute,
  getRouter,
  PostRoute,
  rpc,
  rpcHandler,
  RpcRoute,
} from './app.js';
import {
  createdAt,
  makeQueryClient,
  Post,
  PostNotFound,
  rpcRequest,
  readFrames,
  exitOf,
} from './fixtures.js';

afterAll(async () => {
  await client.dispose();
  await rpcHandler.dispose();
});

describe('README: TanStack Start app', () => {
  test('src/routes/api/rpc.$.ts: the route POST handler answers rpc requests', async () => {
    const handlers = RpcRoute.options.server?.handlers;
    if (handlers === undefined || typeof handlers === 'function') throw new Error('no handlers');
    const post = handlers.POST;
    if (typeof post !== 'function') throw new Error('no POST handler');
    const response = (await post({
      request: rpcRequest('http://localhost:3000/api/rpc/$', 'post.byId', { id: 1 }),
    } as never)) as Response;
    expect(response.status).toBe(200);
    expect(exitOf(await readFrames(response))).toMatchObject({
      _tag: 'Success',
      value: { id: 1, createdAt: createdAt.toISOString() },
    });
  });

  test('the loader fills the router-context QueryClient; SSR dehydrate → hydrate restores instances', async () => {
    // server: the router runs the matched route loaders
    const serverQc = makeQueryClient();
    const serverRouter = getRouter(serverQc, '/posts/1');
    await serverRouter.load();
    expect(serverRouter.state.matches.map((m) => m.routeId)).toContain(PostRoute.id);
    const loaded = serverQc.getQueryData(rpc(serverQc).post.byId.queryKey({ id: 1 }));
    expect(loaded).toBeInstanceOf(Post);

    // the router payload crosses the wire as JSON
    const payload = JSON.parse(JSON.stringify(await serverRouter.options.dehydrate?.())) as {
      queryState: string;
    };

    // browser: a fresh QueryClient is hydrated before rendering
    const browserQc = makeQueryClient();
    const browserRouter = getRouter(browserQc, '/posts/1');
    await browserRouter.options.hydrate?.(payload as never);
    const post = browserQc.getQueryData(rpc(browserQc).post.byId.queryKey({ id: 1 }));
    expect(post).toBeInstanceOf(Post);
    expect(post?.shout()).toBe('HELLO WORLD!');
    expect(post?.createdAt).toEqual(createdAt);
  });

  test('typed errors on an SSR page: the failed prefetch is dehydrated and hydrated as PostNotFound', async () => {
    const serverQc = makeQueryClient();
    const serverRouter = getRouter(serverQc, '/drafts/404');
    await serverRouter.load();
    expect(serverRouter.state.matches.map((m) => m.routeId)).toContain(DraftRoute.id);
    const payload = JSON.parse(JSON.stringify(await serverRouter.options.dehydrate?.())) as {
      queryState: string;
    };

    const browserQc = makeQueryClient();
    await getRouter(browserQc, '/drafts/404').options.hydrate?.(payload as never);
    const state = browserQc.getQueryState(rpc(browserQc).post.byId.queryKey({ id: 404 }));
    expect(state?.status).toBe('error');
    expect(state?.error).toBeInstanceOf(PostNotFound);
    expect(
      state?.error === null || state?.error === undefined ? '' : describeError(state.error),
    ).toBe('No post #404');
  });

  test('ensureQueryData for a missing post rejects with the typed error instance', async () => {
    const queryClient = makeQueryClient();
    const error = await queryClient
      .ensureQueryData(rpc(queryClient).post.byId.queryOptions({ id: 404 }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PostNotFound);
    expect(error).toMatchObject({ _tag: 'PostNotFound', id: 404 });
  });
});
