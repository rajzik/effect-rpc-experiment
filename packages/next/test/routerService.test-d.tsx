import type { Client } from '@rpc-effect/client';
import type { Router } from '@rpc-effect/core';
import type { Caller } from '@rpc-effect/server';
import type { RpcOptionsProxy } from '@rpc-effect/tanstack-react-query';
import type { Exit } from 'effect';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import {
  createNextRpcClient,
  createRouteHandler,
  createRscHelpers,
  createServerActionCaller,
  decodeActionResult,
  unwrapActionResult,
  useServerAction,
} from '../src/index.js';
import type {
  NextRpcClient,
  RouteHandler,
  RscHelpers,
  RscHelpersWithCaller,
  ServerActionCaller,
} from '../src/index.js';
import { AppHandlers, AppRouter, plainRouter } from './service-fixtures.js';
import type { Post, PostNotFound } from './service-fixtures.js';

type AppRouterOf = Router.Of<typeof AppRouter>;
declare const plainClient: Client<typeof plainRouter>;
declare const plainCaller: Caller<typeof plainRouter>;
declare const plainProxy: RpcOptionsProxy<typeof plainRouter>;

describe('Next.js helpers with a router service (types)', () => {
  it('createRouteHandler and createNextRpcClient accept typeof Svc', () => {
    expectTypeOf(
      createRouteHandler(AppRouter, { handlers: AppHandlers }),
    ).toEqualTypeOf<RouteHandler>();
    const next = createNextRpcClient(AppRouter);
    expectTypeOf(next).toEqualTypeOf<NextRpcClient<AppRouterOf>>();
    expectTypeOf(next.useRpcClient().post.byId).toEqualTypeOf<typeof plainClient.post.byId>();
    expectTypeOf(next.useRpc().post.byId.queryKey).toEqualTypeOf(plainProxy.post.byId.queryKey);
    expectTypeOf(createNextRpcClient(AppRouter, { keyPrefix: 'app' })).toEqualTypeOf<
      NextRpcClient<AppRouterOf, 'app'>
    >();
  });

  it('createRscHelpers infers Router.Of<typeof Svc>, like the Router.make equivalent', () => {
    const withCaller = createRscHelpers(AppRouter, { handlers: AppHandlers });
    expectTypeOf(withCaller).toEqualTypeOf<RscHelpersWithCaller<AppRouterOf>>();
    expectTypeOf(withCaller.caller.post.byId).toEqualTypeOf<typeof plainCaller.post.byId>();
    expectTypeOf(withCaller.client.post.byId).toEqualTypeOf<typeof plainClient.post.byId>();
    expectTypeOf(withCaller.rpc.post.byId.queryKey).toEqualTypeOf(plainProxy.post.byId.queryKey);
    const client = withCaller.client;
    expectTypeOf(createRscHelpers(AppRouter, { client }, { keyPrefix: 'rsc' })).toEqualTypeOf<
      RscHelpers<AppRouterOf, 'rsc'>
    >();
  });

  it('server actions are typed from the service router', async () => {
    const actions = createServerActionCaller(AppRouter, { handlers: AppHandlers });
    expectTypeOf(actions).toEqualTypeOf<ServerActionCaller<AppRouterOf>>();
    const encoded = await actions('post.byId')({ id: 1 });
    expectTypeOf(decodeActionResult(AppRouter, 'post.byId', encoded)).toEqualTypeOf<
      ReturnType<typeof decodeActionResult<typeof plainRouter, 'post.byId'>>
    >();
    expectTypeOf(decodeActionResult(AppRouter, 'post.byId', encoded)).toExtend<
      Exit.Exit<Post, PostNotFound | { readonly _tag: `@rpc-effect/${string}` }>
    >();
    expectTypeOf(unwrapActionResult(AppRouter, 'post.byId', encoded)).toEqualTypeOf<
      Promise<Post>
    >();
    // @ts-expect-error - subscriptions are not server actions
    void decodeActionResult(AppRouter, 'post.titles', encoded);
    // (pass the action as a variable: an inline `actions(path)` call is not inferred, for routers too)
    const byId = actions('post.byId');
    const hook = () => useServerAction(byId, { router: AppRouter, path: 'post.byId' });
    expectTypeOf<ReturnType<typeof hook>['data']>().toEqualTypeOf<Post | undefined>();
    // @ts-expect-error - the action's result type does not match "health"
    useServerAction(byId, { router: AppRouter, path: 'health' });
  });
});
