import { createClient, localLink } from '@rpc-effect/client';
import type { Client } from '@rpc-effect/client';
import type { Router } from '@rpc-effect/core';
import type { QueryClient } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import { createHydrationHelpers, createRpcContext, createRpcOptionsProxy } from '../src/index.js';
import type {
  inferProxyError,
  inferProxyInput,
  inferProxyOutput,
  RpcOptionsProxy,
} from '../src/index.js';
import { AppHandlers, AppRouter, plainRouter } from './service-fixtures.js';
import type { Post, PostNotFound } from './service-fixtures.js';

declare const queryClient: QueryClient;
declare const plainProxy: RpcOptionsProxy<typeof plainRouter>;
type AppRouterOf = Router.Of<typeof AppRouter>;

describe('a router service with TanStack Query (types)', () => {
  const client = createClient(AppRouter, { link: localLink({ handlers: AppHandlers }) });

  it('createRpcOptionsProxy infers the proxy of Router.Of<typeof Svc>', () => {
    const rpc = createRpcOptionsProxy({ client, queryClient });
    expectTypeOf(rpc).toEqualTypeOf<RpcOptionsProxy<AppRouterOf>>();
    expectTypeOf<inferProxyInput<typeof rpc.post.byId>>().toEqualTypeOf<
      inferProxyInput<typeof plainProxy.post.byId>
    >();
    expectTypeOf<inferProxyOutput<typeof rpc.post.byId>>().toEqualTypeOf<Post>();
    expectTypeOf<inferProxyOutput<typeof rpc.post.byId>>().toEqualTypeOf<
      inferProxyOutput<typeof plainProxy.post.byId>
    >();
    expectTypeOf<inferProxyError<typeof rpc.post.byId>>().toEqualTypeOf<
      inferProxyError<typeof plainProxy.post.byId>
    >();
    expectTypeOf<
      Extract<inferProxyError<typeof rpc.post.byId>, { readonly _tag: 'PostNotFound' }>
    >().toEqualTypeOf<PostNotFound>();
    expectTypeOf<inferProxyOutput<typeof rpc.post.titles>>().toEqualTypeOf<
      inferProxyOutput<typeof plainProxy.post.titles>
    >();
  });

  it('createRpcContext accepts typeof Svc and equals the Router.Of form', () => {
    const fromClass = createRpcContext<typeof AppRouter>();
    const fromRouter = createRpcContext<AppRouterOf>();
    expectTypeOf(fromClass).toEqualTypeOf(fromRouter);
    expectTypeOf(fromClass.useRpc()).toEqualTypeOf<RpcOptionsProxy<AppRouterOf>>();
    expectTypeOf(fromClass.useRpcClient()).toEqualTypeOf<Client<AppRouterOf>>();
    expectTypeOf(fromClass.RpcProvider).parameter(0).toHaveProperty('client');
    expectTypeOf(fromClass.useRpc().post.byId.queryKey).toEqualTypeOf(
      plainProxy.post.byId.queryKey,
    );
  });

  it('createHydrationHelpers accepts typeof Svc', () => {
    expectTypeOf(createHydrationHelpers(AppRouter)).toEqualTypeOf(
      createHydrationHelpers(plainRouter),
    );
  });
});
