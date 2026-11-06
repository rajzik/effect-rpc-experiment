// Type-level guarantees of the options proxy (run by Vitest typecheck).
import type { Client } from '@effect-trpc/client';
import type { ClientError } from '@effect-trpc/core';
import {
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useSuspenseQuery,
  type InfiniteData,
} from '@tanstack/react-query';
import { describe, expectTypeOf, test } from 'vite-plus/test';
import {
  createRpcOptionsProxy,
  skipToken,
  useSubscription,
  type inferProxyError,
  type inferProxyInput,
  type inferProxyOutput,
  type RpcOptionsProxy,
  type RpcQueryKeyWithoutPrefix,
  type RpcSubscriptionResult,
} from '../src/index.js';
import type { AppRouter, Forbidden, Post, PostNotFound } from './fixtures.js';

declare const client: Client<AppRouter>;
declare const rpc: RpcOptionsProxy<AppRouter>;
const queryClient = new QueryClient();

type Page = { readonly items: ReadonlyArray<Post>; readonly nextCursor: number | null };

describe('queries', () => {
  test('useQuery: data is the output, error is ClientError<E>', () => {
    const query = useQuery(rpc.post.byId.queryOptions({ id: 1 }));
    expectTypeOf(query.data).toEqualTypeOf<Post | undefined>();
    expectTypeOf(query.error).toEqualTypeOf<ClientError<PostNotFound | Forbidden> | null>();
    const suspense = useSuspenseQuery(rpc.post.byId.queryOptions({ id: 1 }));
    expectTypeOf(suspense.data).toEqualTypeOf<Post>();
  });

  test('procedures without typed errors still carry the infrastructure errors', () => {
    const query = useQuery(rpc.health.queryOptions());
    expectTypeOf(query.data).toEqualTypeOf<'ok' | undefined>();
    expectTypeOf(query.error).toEqualTypeOf<ClientError<never> | null>();
  });

  test('inputs are checked; skipToken is accepted', () => {
    expectTypeOf(rpc.post.byId.queryOptions(skipToken).queryFn).not.toBeUndefined();
    // @ts-expect-error - wrong input type
    rpc.post.byId.queryOptions({ id: '1' });
    // @ts-expect-error - missing input
    rpc.post.byId.queryOptions();
    rpc.health.queryOptions();
  });

  test('data-tagged keys type the QueryClient', () => {
    expectTypeOf(queryClient.getQueryData(rpc.post.byId.queryKey({ id: 1 }))).toEqualTypeOf<
      Post | undefined
    >();
    expectTypeOf(queryClient.getQueryState(rpc.post.byId.queryKey())?.error).toEqualTypeOf<
      ClientError<PostNotFound | Forbidden> | null | undefined
    >();
    expectTypeOf(rpc.post.pathKey()).toEqualTypeOf<RpcQueryKeyWithoutPrefix>();
    // the tag is the cached (unselected) data, like TanStack's `queryOptions`
    const selected = rpc.post.byId.queryOptions({ id: 1 }, { select: (post) => post.title });
    expectTypeOf(queryClient.getQueryData(selected.queryKey)).toEqualTypeOf<Post | undefined>();
    expectTypeOf(useQuery(selected).data).toEqualTypeOf<string | undefined>();
    expectTypeOf(
      queryClient.getQueryData(rpc.post.list.infiniteQueryKey({ limit: 1 })),
    ).toEqualTypeOf<InfiniteData<Page, number | null> | undefined>();
  });

  test('infinite queries only for cursor inputs', () => {
    const query = useInfiniteQuery(
      rpc.post.list.infiniteQueryOptions({}, { getNextPageParam: (page) => page.nextCursor }),
    );
    expectTypeOf(query.data).toEqualTypeOf<InfiniteData<Page, number | null> | undefined>();
    expectTypeOf(query.error).toEqualTypeOf<ClientError<never> | null>();
    // @ts-expect-error - post.byId has no cursor
    void rpc.post.byId.infiniteQueryOptions;
  });
});

describe('mutations', () => {
  test('useMutation: variables, data and ClientError<E>', () => {
    const mutation = useMutation(rpc.post.create.mutationOptions());
    expectTypeOf(mutation.data).toEqualTypeOf<Post | undefined>();
    expectTypeOf(mutation.error).toEqualTypeOf<ClientError<Forbidden> | null>();
    expectTypeOf(mutation.mutate).parameter(0).toEqualTypeOf<{ readonly title: string }>();
    const reset = useMutation(rpc.post.reset.mutationOptions());
    reset.mutate();
  });

  test('only mutations have mutation helpers', () => {
    // @ts-expect-error - not a mutation
    void rpc.post.byId.mutationOptions;
    // @ts-expect-error - not a query
    void rpc.post.create.queryOptions;
    // @ts-expect-error - routers only have path helpers
    void rpc.post.queryOptions;
    expectTypeOf(rpc.post.create.mutationKey).returns.toEqualTypeOf<[path: string[]]>();
  });
});

describe('subscriptions', () => {
  test('useSubscription: data is the element type, error is ClientError<E>', () => {
    const result = useSubscription(
      rpc.ticks.subscriptionOptions(
        { n: 1 },
        {
          onData: (value) => expectTypeOf(value).toEqualTypeOf<number>(),
          onError: (error) => expectTypeOf(error).toEqualTypeOf<ClientError<PostNotFound>>(),
        },
      ),
    );
    expectTypeOf(result).toEqualTypeOf<RpcSubscriptionResult<number, ClientError<PostNotFound>>>();
    if (result.status === 'error') {
      expectTypeOf(result.error).toEqualTypeOf<ClientError<PostNotFound>>();
    }
    rpc.events.subscriptionOptions(skipToken);
  });
});

describe('proxy', () => {
  test('createRpcOptionsProxy infers the router from the client', () => {
    const proxy = createRpcOptionsProxy({ client, queryClient });
    expectTypeOf(proxy).toEqualTypeOf<RpcOptionsProxy<AppRouter>>();
    // @ts-expect-error - keyPrefix needs the `{ keyPrefix: true }` flag
    createRpcOptionsProxy({ client, keyPrefix: 'x' });
    createRpcOptionsProxy<AppRouter, { keyPrefix: true }>({ client, keyPrefix: 'x' });
  });

  test('inferProxyInput / inferProxyOutput / inferProxyError', () => {
    expectTypeOf<inferProxyInput<typeof rpc.post.byId>>().toEqualTypeOf<{
      readonly id: number;
    }>();
    expectTypeOf<inferProxyOutput<typeof rpc.post.byId>>().toEqualTypeOf<Post>();
    expectTypeOf<inferProxyError<typeof rpc.post.create>>().toEqualTypeOf<ClientError<Forbidden>>();
  });
});
