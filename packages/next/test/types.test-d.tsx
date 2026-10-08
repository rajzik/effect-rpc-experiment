// Type tests: Next.js route handler compatibility, server action input/output/error types.
import type { ClientError, RpcDefect, RpcInterrupted, RpcTransportError } from '@effect-trpc/core';
import type { Exit } from 'effect';
import type { NextRequest } from 'next/server.js'; // NodeNext ESM: next has no `exports` map
import { describe, expectTypeOf, test } from 'vite-plus/test';
import {
  createNextRpcClient,
  createRouteHandler,
  createRscHelpers,
  createServerActionCaller,
  decodeActionResult,
  unwrapActionResult,
  useServerAction,
  type ActionPath,
  type EncodedActionResult,
  type inferActionClientError,
  type inferActionError,
  type inferActionOutput,
  type ServerAction,
  type ServerActionStatus,
} from '../src/index.js';
import {
  appRouter,
  makeFixture,
  type AppRouter,
  type Forbidden,
  type Post,
  type PostNotFound,
} from './fixtures.js';

const { handlers } = makeFixture();

describe('createRouteHandler', () => {
  test('GET / POST are Next.js App Router route handlers', () => {
    const { GET, POST } = createRouteHandler(appRouter, { handlers });
    expectTypeOf(POST).toExtend<(req: NextRequest) => Promise<Response>>();
    expectTypeOf(GET).toExtend<(req: NextRequest) => Promise<Response>>();
    // Next passes a second `{ params }` argument to dynamic routes: extra args are fine
    expectTypeOf(POST).toExtend<
      (req: NextRequest, ctx: { params: Promise<{ rpc?: string[] }> }) => Promise<Response>
    >();
    expectTypeOf(POST).toExtend<(req: Request) => Promise<Response>>();
  });

  test('the handlers layer must implement the whole router', () => {
    expectTypeOf(createRouteHandler<typeof appRouter>)
      .parameter(1)
      .toHaveProperty('handlers');
    // @ts-expect-error - not a handler layer of this router
    createRouteHandler(appRouter, { handlers: 'nope' });
    // @ts-expect-error - path must start with a slash
    createRouteHandler(appRouter, { handlers, path: 'api/rpc' });
  });
});

describe('server actions', () => {
  const actions = createServerActionCaller(appRouter, { handlers });

  test('actions carry the procedure input / output / error', () => {
    const byId = actions('post.byId');
    expectTypeOf(byId).parameters.toEqualTypeOf<[input: { readonly id: number }]>();
    expectTypeOf(byId).returns.resolves.toExtend<EncodedActionResult<Post, PostNotFound>>();
    expectTypeOf<inferActionOutput<typeof byId>>().toEqualTypeOf<Post>();
    expectTypeOf<inferActionError<typeof byId>>().toEqualTypeOf<PostNotFound>();
    // no input: the argument is optional
    expectTypeOf(actions('post.count')).toBeCallableWith();
    // nested form has the same type
    expectTypeOf(actions.nested.post.create).toEqualTypeOf<
      ServerAction<AppRouter['record']['post']['create']>
    >();
    expectTypeOf<inferActionError<typeof actions.nested.post.create>>().toEqualTypeOf<Forbidden>();
  });

  test('subscriptions are not action paths', () => {
    expectTypeOf<ActionPath<AppRouter>>().toEqualTypeOf<
      'boom' | 'post.byId' | 'post.list' | 'post.create' | 'post.count' | 'post.whoami'
    >();
    // @ts-expect-error - subscriptions cannot be server actions
    actions('ticks');
    // @ts-expect-error - unknown path
    actions('post.nope');
    // @ts-expect-error - wrong input
    void actions('post.byId')({ id: '1' });
  });

  test('decodeActionResult: Exit<A, ClientError<E>>', async () => {
    const encoded = await actions('post.byId')({ id: 1 });
    const exit = decodeActionResult(appRouter, 'post.byId', encoded);
    expectTypeOf(exit).toEqualTypeOf<Exit.Exit<Post, ClientError<PostNotFound>>>();
    expectTypeOf<ClientError<PostNotFound>>().toEqualTypeOf<
      PostNotFound | RpcDefect | RpcTransportError | RpcInterrupted
    >();
  });

  test('unwrapActionResult resolves A; its rejection type is ClientError<E>', () => {
    const post = unwrapActionResult(
      appRouter,
      'post.create',
      actions('post.create')({ title: 'x' }),
    );
    expectTypeOf(post).toEqualTypeOf<Promise<Post>>();
    // what `unwrapActionResult` / `client.post.create` reject with
    type Rejection = inferActionClientError<ReturnType<typeof actions<'post.create'>>>;
    expectTypeOf<Rejection>().toEqualTypeOf<
      Forbidden | RpcDefect | RpcTransportError | RpcInterrupted
    >();
  });

  test('useServerAction infers the result types from the action', () => {
    const create = actions('post.create');
    const useIt = () => useServerAction(create, { router: appRouter, path: 'post.create' });
    type Result = ReturnType<typeof useIt>;
    expectTypeOf<Result['data']>().toEqualTypeOf<Post | undefined>();
    expectTypeOf<Result['error']>().toEqualTypeOf<ClientError<Forbidden> | null>();
    expectTypeOf<Result['status']>().toEqualTypeOf<ServerActionStatus>();
    expectTypeOf<Result['run']>().toEqualTypeOf<
      (input: {
        readonly title: string;
        readonly at?: Date | undefined;
      }) => Promise<Exit.Exit<Post, ClientError<Forbidden>>>
    >();
  });
});

describe('RSC helpers', () => {
  test('rpc is the options proxy; TError is ClientError<E>; caller only with handlers', () => {
    const helpers = createRscHelpers(appRouter, { handlers });
    const options = helpers.rpc.post.byId.queryOptions({ id: 1 });
    helpers.prefetch(options);
    helpers.prefetch(
      helpers.rpc.post.list.infiniteQueryOptions({}, { getNextPageParam: (p) => p.nextCursor }),
    );
    expectTypeOf(helpers.getQueryClient().getQueryData(options.queryKey)).toEqualTypeOf<
      Post | undefined
    >();
    expectTypeOf(helpers.caller.$promise.post.byId).returns.toEqualTypeOf<Promise<Post>>();
    const external = createRscHelpers(appRouter, { client: helpers.client });
    expectTypeOf(external).not.toHaveProperty('caller');
  });

  test('createNextRpcClient: useRpc is the options proxy of the router', () => {
    const { useRpc } = createNextRpcClient(appRouter, { url: '/api/rpc' });
    type Proxy = ReturnType<typeof useRpc>;
    expectTypeOf<Proxy['post']['byId']['~types']['error']>().toEqualTypeOf<
      ClientError<PostNotFound>
    >();
  });
});
