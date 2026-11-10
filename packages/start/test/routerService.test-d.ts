import type { Client } from '@rpc-effect/client';
import type { Router } from '@rpc-effect/core';
import type { RpcOptionsProxy } from '@rpc-effect/tanstack-react-query';
import type { QueryClient } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import {
  createBrowserClient,
  createIsomorphicClient,
  createServerClient,
  createStartHandler,
  createStartHelpers,
  createStartHydration,
} from '../src/index.js';
import type { StartHandler, StartHelpers, StartHydration } from '../src/index.js';
import { AppHandlers, AppRouter, plainRouter } from './service-fixtures.js';
import type { Post } from './service-fixtures.js';

type AppRouterOf = Router.Of<typeof AppRouter>;
declare const plainClient: Client<typeof plainRouter>;
declare const plainProxy: RpcOptionsProxy<typeof plainRouter>;
declare const queryClient: QueryClient;

describe('TanStack Start helpers with a router service (types)', () => {
  it('createStartHandler and the clients accept typeof Svc', () => {
    expectTypeOf(
      createStartHandler(AppRouter, { handlers: AppHandlers }),
    ).toEqualTypeOf<StartHandler>();
    const server = createServerClient(AppRouter, { handlers: AppHandlers });
    expectTypeOf(server).toEqualTypeOf<Client<AppRouterOf>>();
    expectTypeOf(server.post.byId).toEqualTypeOf<typeof plainClient.post.byId>();
    expectTypeOf(createBrowserClient(AppRouter)).toEqualTypeOf<Client<AppRouterOf>>();
    expectTypeOf(
      createIsomorphicClient(AppRouter, { server: { handlers: AppHandlers }, client: {} }),
    ).toEqualTypeOf<Client<AppRouterOf>>();
    // @ts-expect-error - the handlers of the service's procedures are required
    createServerClient(AppRouter, { handlers: plainHandlersMissing });
  });

  it('createStartHelpers infers Router.Of<typeof Svc>, like the Router.make equivalent', () => {
    const client = createServerClient(AppRouter, { handlers: AppHandlers });
    const helpers = createStartHelpers(AppRouter, { client });
    expectTypeOf(helpers).toEqualTypeOf<StartHelpers<AppRouterOf>>();
    const rpc = helpers.rpc(queryClient);
    expectTypeOf(rpc.post.byId.queryKey).toEqualTypeOf(plainProxy.post.byId.queryKey);
    expectTypeOf(helpers.useRpcClient().post.byId).returns.toEqualTypeOf<Promise<Post>>();
    expectTypeOf(createStartHydration(AppRouter)).toEqualTypeOf<StartHydration>();
  });
});

declare const plainHandlersMissing: import('effect').Layer.Layer<never>;
