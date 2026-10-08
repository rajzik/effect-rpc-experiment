import { Effect, Stream } from 'effect';
import { RpcTest } from 'effect/rpc';
import type { RpcClient } from 'effect/rpc';
import { describe, expect, it } from 'vite-plus/test';
import { causeToClientError, RpcDefect, type Router } from '../src/index.js';
import { appRouter, Forbidden, getCause, Post, PostNotFound, samplePost } from './fixtures.js';

const HandlersLive = appRouter.group.toLayer({
  health: () => Effect.succeed('ok' as const),
  'post.byId': ({ id }) =>
    id === 1
      ? Effect.succeed(samplePost())
      : id === 2
        ? Effect.fail(new Forbidden({ reason: 'private' }))
        : id === 3
          ? Effect.die(new Error('database exploded'))
          : Effect.fail(new PostNotFound({ id })),
  'post.create': ({ title }) => Effect.succeed(new Post({ id: 2, title, createdAt: new Date(0) })),
  'post.onPost': ({ since }) =>
    Stream.fromIterable([since, since + 1, since + 2]).pipe(
      Stream.map((id) => new Post({ id, title: `Post ${id}`, createdAt: new Date(id * 1000) })),
    ),
  'admin.stats.count': () => Effect.succeed(42),
  'deep.a.b': () => Effect.succeed('deep'),
});

type AppClient = RpcClient.RpcClient<Router.Rpcs<typeof appRouter>>;

const run = <A, E>(f: (client: AppClient) => Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(
    RpcTest.makeClient(appRouter.group).pipe(
      Effect.flatMap(f),
      Effect.scoped,
      Effect.provide(HandlersLive),
    ),
  );

describe('end-to-end through RpcTest.makeClient(router.group)', () => {
  it('returns Schema.Class instances with callable methods and Date fields', async () => {
    const post = await run((client) => client['post.byId']({ id: 1 }));
    expect(post).toBeInstanceOf(Post);
    expect(post.describe()).toBe('#1 Hello World');
    expect(post.slug).toBe('hello-world');
    expect(post.createdAt).toBeInstanceOf(Date);
    expect(post.createdAt.toISOString()).toBe('2026-01-02T03:04:05.000Z');
  });

  it('fails with TaggedError instances from the error union', async () => {
    const notFound = await run((client) => Effect.flip(client['post.byId']({ id: 7 })));
    expect(notFound).toBeInstanceOf(PostNotFound);
    expect(notFound._tag).toBe('PostNotFound');
    const forbidden = await run((client) => Effect.flip(client['post.byId']({ id: 2 })));
    expect(forbidden).toBeInstanceOf(Forbidden);
    expect(forbidden).toMatchObject({ _tag: 'Forbidden', reason: 'private' });
  });

  it('maps a handler defect to RpcDefect via causeToClientError', async () => {
    const exit = await run((client) => Effect.exit(client['post.byId']({ id: 3 })));
    const error = causeToClientError(getCause(exit));
    expect(error).toBeInstanceOf(RpcDefect);
    expect(error).toMatchObject({ _tag: '@effect-trpc/RpcDefect', message: 'database exploded' });
  });

  it('streams subscription elements as class instances', async () => {
    const posts = await run((client) => Stream.runCollect(client['post.onPost']({ since: 10 })));
    expect(posts.map((post) => post.id)).toEqual([10, 11, 12]);
    for (const post of posts) {
      expect(post).toBeInstanceOf(Post);
      expect(post.createdAt).toBeInstanceOf(Date);
    }
  });

  it('calls void-payload, mutation and nested procedures', async () => {
    const [health, created, count, deep] = await run((client) =>
      Effect.all([
        client.health(),
        client['post.create']({ title: 'New' }),
        client['admin.stats.count'](),
        client['deep.a.b'](),
      ]),
    );
    expect(health).toBe('ok');
    expect(created).toBeInstanceOf(Post);
    expect(created.title).toBe('New');
    expect(count).toBe(42);
    expect(deep).toBe('deep');
  });
});
