// @vitest-environment jsdom
// Executes the README walkthrough: router + handlers, route.ts, trpc/client.tsx, trpc/server.tsx,
// page.tsx and a server action with typed errors. Next-only pieces are stubbed: `headers()` is a
// function returning `Headers`, `React.cache` is a per-"request" scope and `fetch` goes straight
// into the route handler.
import { mutation, query, Router } from '@effect-trpc/core';
import { Handlers } from '@effect-trpc/server';
import { useSuspenseQuery } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Effect, Schema } from 'effect';
import * as React from 'react';
import { afterEach, describe, expect, test } from 'vite-plus/test';
import {
  createNextRpcClient,
  createRouteHandler,
  createRscHelpers,
  createServerActionCaller,
  useServerAction,
  type InputAt,
} from '../src/index.js';

afterEach(cleanup);

// ---- 1. server/router.ts ----------------------------------------------------------------------

class Post extends Schema.Class<Post>('Post')({
  id: Schema.Number,
  title: Schema.String,
  createdAt: Schema.Date,
}) {
  get headline() {
    return `${this.title} (${this.createdAt.getUTCFullYear()})`;
  }
}
class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.Number,
}) {}
class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {
  reason: Schema.String,
}) {}

const appRouter = Router.make({
  post: {
    byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }),
    create: mutation({ payload: { title: Schema.String }, success: Post, error: Forbidden }),
  },
});
type AppRouter = typeof appRouter;

// ---- server/handlers.ts -------------------------------------------------------------------------

const createdAt = new Date('2026-03-04T00:00:00.000Z');
const HandlersLive = Handlers.make(appRouter, {
  post: {
    byId: ({ id }) =>
      id === 1
        ? Effect.succeed(new Post({ id, title: 'Hello', createdAt }))
        : Effect.fail(new PostNotFound({ id })),
    create: ({ title }, { headers }) =>
      headers['x-user'] === undefined
        ? Effect.fail(new Forbidden({ reason: 'sign in first' }))
        : Effect.succeed(new Post({ id: 2, title, createdAt })),
  },
});

// ---- stubs for Next.js ------------------------------------------------------------------------

let requestHeaders = new Headers();
/** `next/headers`' `headers()`. */
const headers = async (): Promise<Headers> => requestHeaders;
/** `React.cache` scoped to one request. */
let scope = new Map<unknown, unknown>();
const cache =
  <T,>(fn: () => T) =>
  (): T => {
    if (!scope.has(fn)) scope.set(fn, fn());
    return scope.get(fn) as T;
  };

// ---- 2. app/api/rpc/[[...rpc]]/route.ts ---------------------------------------------------------

const route = createRouteHandler(appRouter, { handlers: HandlersLive });
const { GET, POST } = route;

// ---- 4. trpc/client.tsx ('use client') ----------------------------------------------------------

let browserFetches = 0;
const { RpcProvider, useRpc, HydrationBoundary } = createNextRpcClient(appRouter, {
  url: '/api/rpc',
  fetch: (input, init) => {
    browserFetches++;
    return POST(new Request(input, init));
  },
});

// ---- 5. trpc/server.tsx -----------------------------------------------------------------------

const { getQueryClient, rpc, HydrateClient, prefetch, caller } = createRscHelpers(
  appRouter,
  { handlers: HandlersLive, headers: async () => await headers() },
  { HydrationBoundary, cache },
);

// ---- 6. app/page.tsx + app/post-view.tsx --------------------------------------------------------

function PostView({ id }: { id: number }) {
  const rpc = useRpc();
  const { data } = useSuspenseQuery(rpc.post.byId.queryOptions({ id }));
  return <h1>{data.headline}</h1>;
}

function Page() {
  prefetch(rpc.post.byId.queryOptions({ id: 1 }));
  return (
    <HydrateClient>
      <PostView id={1} />
    </HydrateClient>
  );
}

// ---- 7. app/actions.ts ('use server') + app/new-post.tsx ----------------------------------------

const actions = createServerActionCaller(appRouter, {
  handlers: HandlersLive,
  headers: async () => await headers(),
});

async function createPost(input: InputAt<AppRouter, 'post.create'>) {
  return actions('post.create')(input);
}

function NewPost() {
  const create = useServerAction(createPost, { router: appRouter, path: 'post.create' });
  const [title, setTitle] = React.useState('');
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void create.run({ title });
      }}
    >
      <input aria-label="title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <button type="submit" disabled={create.isPending}>
        Create
      </button>
      {create.data && <p>Created {create.data.headline}</p>}
      {create.error?._tag === 'Forbidden' && <p>Forbidden: {create.error.reason}</p>}
    </form>
  );
}

describe('README', () => {
  test('route.ts: POST serves the router, GET is 405', async () => {
    expect((await GET(new Request('http://localhost/api/rpc'))).status).toBe(405);
  });

  test('page.tsx: server prefetch is hydrated as a Post instance without a client fetch', async () => {
    scope = new Map();
    browserFetches = 0;
    // a Next server render: prefetch starts in Page, HydrateClient dehydrates (pending)
    render(
      <RpcProvider>
        <React.Suspense fallback={<p>loading</p>}>
          <Page />
        </React.Suspense>
      </RpcProvider>,
    );
    expect(await screen.findByText('Hello (2026)')).toBeDefined();
    expect(browserFetches).toBe(0);
    expect(getQueryClient().getQueryData(rpc.post.byId.queryKey({ id: 1 }))).toBeInstanceOf(Post);
  });

  test('server.tsx caller reads directly', async () => {
    const post = await caller.$promise.post.byId({ id: 1 });
    expect(post.headline).toBe('Hello (2026)');
  });

  test('actions: typed error when signed out, a Post when signed in', async () => {
    requestHeaders = new Headers();
    render(<NewPost />);
    fireEvent.change(screen.getByLabelText('title'), { target: { value: 'News' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Create'));
    });
    expect(await screen.findByText('Forbidden: sign in first')).toBeDefined();

    requestHeaders = new Headers({ 'x-user': 'ada' });
    await act(async () => {
      fireEvent.click(screen.getByText('Create'));
    });
    expect(await screen.findByText('Created News (2026)')).toBeDefined();
  });

  test('client components can also call the route handler over httpLink', async () => {
    browserFetches = 0;
    function Lazy() {
      const rpc = useRpc();
      const { data } = useSuspenseQuery(rpc.post.byId.queryOptions({ id: 1 }));
      return <p>lazy {data.headline}</p>;
    }
    render(
      <RpcProvider queryClient={undefined}>
        <React.Suspense fallback={<p>loading</p>}>
          <Lazy />
        </React.Suspense>
      </RpcProvider>,
    );
    expect(await screen.findByText('lazy Hello (2026)')).toBeDefined();
    await route.dispose();
    await actions.dispose();
    await caller.dispose();
  });
});
