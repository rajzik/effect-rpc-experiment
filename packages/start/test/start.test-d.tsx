// Type tests: the Start handler fits TanStack Start's server route handler type; clients and
// helpers keep output and typed-error types.
import type { Client, ClientError } from '@effect-trpc/client';
import type { RpcOptionsProxy } from '@effect-trpc/tanstack-react-query';
import type { QueryClient } from '@tanstack/react-query';
import { createFileRoute, type AnyRoute, type Register } from '@tanstack/react-router';
import type { RouteMethodHandlerFn } from '@tanstack/react-start';
import { describe, expectTypeOf, test } from 'vite-plus/test';
import {
  createBrowserClient,
  createIsomorphicClient,
  createServerClient,
  createStartHandler,
  createStartHelpers,
  type StartHandler,
} from '../src/index.js';
import { rootRoute, rpc, rpcHandler } from './app.js';
import {
  appRouter,
  makeFixture,
  type AppRouter,
  type Post,
  type PostNotFound,
} from './fixtures.js';

declare const queryClient: QueryClient;

describe('createStartHandler', () => {
  test('is assignable to a Start server route method handler (POST and GET)', () => {
    const handler = createStartHandler(appRouter, { handlers: makeFixture().handlers });
    expectTypeOf(handler).toEqualTypeOf<StartHandler>();
    type PostHandler = RouteMethodHandlerFn<
      Register,
      typeof rootRoute,
      '/api/rpc/$',
      { _splat?: string },
      undefined,
      undefined,
      undefined
    >;
    expectTypeOf(handler).toExtend<PostHandler>();
    expectTypeOf(handler).toExtend<
      RouteMethodHandlerFn<Register, AnyRoute, string, unknown, unknown, unknown, unknown>
    >();
    expectTypeOf(handler.dispose).toEqualTypeOf<() => Promise<void>>();
    // the real file-route API accepts it under any method key
    createFileRoute('/api/rpc/$')({
      server: { handlers: { POST: rpcHandler, GET: rpcHandler, ANY: rpcHandler } },
    });
  });

  test('requires a handler layer implementing the router', () => {
    expectTypeOf(createStartHandler<AppRouter>)
      .parameter(1)
      .toHaveProperty('handlers');
    // @ts-expect-error -- handlers is required
    createStartHandler(appRouter, {});
    // @ts-expect-error -- path must be a string
    createStartHandler(appRouter, { handlers: makeFixture().handlers, path: 1 });
  });
});

describe('clients', () => {
  test('createIsomorphicClient / createServerClient / createBrowserClient return Client<R>', () => {
    const { handlers } = makeFixture();
    const iso = createIsomorphicClient(appRouter, {
      server: { handlers },
      client: { url: '/api/rpc' },
    });
    expectTypeOf(iso).toEqualTypeOf<Client<AppRouter>>();
    expectTypeOf(createServerClient(appRouter, { handlers })).toEqualTypeOf<Client<AppRouter>>();
    expectTypeOf(createBrowserClient(appRouter, { url: '/api/rpc' })).toEqualTypeOf<
      Client<AppRouter>
    >();
    expectTypeOf(iso.post.byId).returns.resolves.toEqualTypeOf<Post>();
    // @ts-expect-error -- server.handlers is required
    createIsomorphicClient(appRouter, { server: {}, client: { url: '/api/rpc' } });
  });
});

describe('createStartHelpers', () => {
  test('rpc(queryClient) is the options proxy, with typed data and errors', () => {
    expectTypeOf(rpc).returns.toEqualTypeOf<RpcOptionsProxy<AppRouter>>();
    const options = rpc(queryClient).post.byId.queryOptions({ id: 1 });
    expectTypeOf(queryClient.ensureQueryData(options)).resolves.toEqualTypeOf<Post>();
    expectTypeOf(rpc(queryClient).post.byId['~types'].error).toEqualTypeOf<
      ClientError<PostNotFound>
    >();
    // typed error handling by `_tag`
    const describeError = (error: ClientError<PostNotFound>): string => {
      switch (error._tag) {
        case 'PostNotFound':
          return `no post ${error.id}`;
        case '@effect-trpc/RpcDefect':
        case '@effect-trpc/RpcTransportError':
          return error.message;
        case '@effect-trpc/RpcInterrupted':
          return 'cancelled';
      }
    };
    expectTypeOf(describeError).returns.toBeString();
  });

  test('keyPrefix requires the feature flag', () => {
    const client = createServerClient(appRouter, { handlers: makeFixture().handlers });
    // @ts-expect-error -- keyPrefix needs `{ keyPrefix: true }` flags
    createStartHelpers(appRouter, { client, keyPrefix: 'x' });
    const prefixed = createStartHelpers<AppRouter, { keyPrefix: true }>(appRouter, {
      client,
      keyPrefix: 'x',
    });
    expectTypeOf(prefixed.rpc).returns.toEqualTypeOf<
      RpcOptionsProxy<AppRouter, { keyPrefix: true }>
    >();
  });
});
