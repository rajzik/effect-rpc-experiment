// @vitest-environment jsdom
// Executes the examples of README.md. Only the link differs (an in-process `localLink` instead of
// `httpLink`), plus the server-side handlers the README leaves to @effect-trpc/server.
import { createClient, localLink, RpcTransportError, type Client } from '@effect-trpc/client';
import { mutation, query, Router, subscription } from '@effect-trpc/core';
import { Handlers } from '@effect-trpc/server';
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type DehydratedState,
} from '@tanstack/react-query';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { Effect, Schema, Stream } from 'effect';
import { useState } from 'react';
import * as React from 'react';
import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import {
  createHydrationHelpers,
  createRpcContext,
  createRpcOptionsProxy,
  useSubscription,
} from '../src/index.js';
import { waitFor } from './helpers.js';

// ---- 1. Define the router -------------------------------------------------------------------

export class Post extends Schema.Class<Post>('Post')({
  id: Schema.Number,
  title: Schema.String,
  createdAt: Schema.Date,
}) {
  get headline(): string {
    return `${this.title} (${this.createdAt.getUTCFullYear()})`;
  }
}

export class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.Number,
}) {}

export const appRouter = Router.make({
  post: {
    byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }),
    // a `cursor` in the input enables `infiniteQueryOptions`
    list: query({
      payload: { cursor: Schema.optional(Schema.NullOr(Schema.Number)) },
      success: Schema.Struct({
        items: Schema.Array(Post),
        nextCursor: Schema.NullOr(Schema.Number),
      }),
    }),
    create: mutation({ payload: { title: Schema.String }, success: Post }),
  },
  countdown: subscription({ payload: { from: Schema.Number }, success: Schema.Number }),
});
export type AppRouter = typeof appRouter;

// (server side, not in the README)
const posts = [new Post({ id: 1, title: 'First', createdAt: new Date('2026-05-01T00:00:00Z') })];
const handlers = Handlers.make(appRouter, {
  post: {
    byId: ({ id }) => {
      const post = posts.find((p) => p.id === id);
      return post === undefined ? Effect.fail(new PostNotFound({ id })) : Effect.succeed(post);
    },
    list: ({ cursor }) =>
      Effect.sync(() => {
        const start = cursor ?? 0;
        return {
          items: posts.slice(start, start + 1),
          nextCursor: start + 1 < posts.length ? start + 1 : null,
        };
      }),
    create: ({ title }) =>
      Effect.sync(() => {
        const post = new Post({ id: posts.length + 1, title, createdAt: new Date() });
        posts.push(post);
        return post;
      }),
  },
  countdown: ({ from }) => Stream.range(0, from - 1).pipe(Stream.map((i) => from - i)),
});
const makeClient = () => createClient(appRouter, { link: localLink({ handlers }) });

// ---- 2. Set up the context provider ---------------------------------------------------------

export const { RpcProvider, useRpc, useRpcClient } = createRpcContext<AppRouter>();

export function App({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // retry network failures only: typed errors and defects will not change on retry
        defaultOptions: { queries: { retry: (n, e) => e instanceof RpcTransportError && n < 3 } },
      }),
  );
  const [client] = useState(makeClient);
  return (
    <QueryClientProvider client={queryClient}>
      <RpcProvider client={client} queryClient={queryClient}>
        {children}
      </RpcProvider>
    </QueryClientProvider>
  );
}

// ---- 3. Queries, with errors narrowed by `_tag` ---------------------------------------------

export function PostView({ id }: { id: number }) {
  const rpc = useRpc();
  const post = useQuery(rpc.post.byId.queryOptions({ id }));
  if (post.error) {
    switch (post.error._tag) {
      case 'PostNotFound':
        return <p>No post #{post.error.id}</p>;
      default:
        return <p>Something went wrong: {post.error.message}</p>;
    }
  }
  if (!post.data) return <p>Loading…</p>;
  return <h1>{post.data.headline}</h1>;
}

// ---- 4. Mutations and invalidation ----------------------------------------------------------

export function CreatePost() {
  const rpc = useRpc();
  const queryClient = useQueryClient();
  const create = useMutation(
    rpc.post.create.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(rpc.post.pathFilter()),
    }),
  );
  return <button onClick={() => create.mutate({ title: 'Hello' })}>Create</button>;
}

// ---- 5. Infinite queries --------------------------------------------------------------------

export function PostList() {
  const rpc = useRpc();
  const posts = useInfiniteQuery(
    rpc.post.list.infiniteQueryOptions({}, { getNextPageParam: (page) => page.nextCursor }),
  );
  return (
    <ul>
      {posts.data?.pages.flatMap((page) => page.items.map((p) => <li key={p.id}>{p.title}</li>))}
      <li>
        <button onClick={() => void posts.fetchNextPage()}>more</button>
      </li>
    </ul>
  );
}

// ---- 6. Subscriptions -----------------------------------------------------------------------

const log = vi.fn<(n: number) => void>();

export function Countdown() {
  const rpc = useRpc();
  const sub = useSubscription(rpc.countdown.subscriptionOptions({ from: 3 }, { onData: log }));
  return <p>{sub.status === 'error' ? sub.error.message : (sub.data ?? '…')}</p>;
}

// ---- 7. SSR hydration with class instances --------------------------------------------------

export const { dehydrate, HydrationBoundary } = createHydrationHelpers(appRouter);

export async function loadPostPage(client: Client<AppRouter>, id: number) {
  const queryClient = new QueryClient();
  const rpc = createRpcOptionsProxy({ client, queryClient });
  await queryClient.prefetchQuery(rpc.post.byId.queryOptions({ id }));
  return dehydrate(queryClient);
}

export function PostPage({ state, id }: { state: DehydratedState; id: number }) {
  return (
    <HydrationBoundary state={state}>
      <PostView id={id} />
    </HydrationBoundary>
  );
}

// ---------------------------------------------------------------------------------------------

describe('README', () => {
  afterEach(() => {
    cleanup();
  });

  test('queries render class instances and typed errors', async () => {
    const utils = render(
      <App>
        <PostView id={1} />
        <PostView id={42} />
      </App>,
    );
    await waitFor(() => {
      expect(utils.container.textContent).toBe('First (2026)No post #42');
    });
  });

  test('mutations invalidate, infinite queries page, subscriptions stream', async () => {
    const utils = render(
      <App>
        <PostList />
        <CreatePost />
        <Countdown />
      </App>,
    );
    await waitFor(() => {
      expect(utils.container.querySelector('ul')?.textContent).toBe('Firstmore');
      expect(utils.container.querySelector('p')?.textContent).toBe('1');
    });
    expect(log.mock.calls).toEqual([[3], [2], [1]]);
    await act(async () => {
      fireEvent.click(utils.getByText('Create'));
    });
    // the invalidated list now knows about a next page
    await act(async () => {
      fireEvent.click(utils.getByText('more'));
    });
    await waitFor(() => {
      expect(utils.container.querySelector('ul')?.textContent).toBe('FirstHellomore');
    });
  });

  test('SSR: dehydrated Post instances render on the client', async () => {
    const client = makeClient();
    const state = JSON.parse(JSON.stringify(await loadPostPage(client, 1))) as DehydratedState;
    await client.dispose();
    const utils = render(
      <App>
        <PostPage state={state} id={1} />
      </App>,
    );
    // no loading state: the hydrated value is a real `Post` (its getter works)
    expect(utils.container.textContent).toBe('First (2026)');
  });
});
