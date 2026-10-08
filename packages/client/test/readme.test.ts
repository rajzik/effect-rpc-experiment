// Executes the examples of README.md (only the server URL and logging differ).
import { mutation, query, Router, subscription } from '@effect-trpc/core';
import { Effect, Schema, Stream } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import {
  createClient,
  httpLink,
  localLink,
  RpcInterrupted,
  wsLink,
  type Client,
} from '../src/index.js';
import { serveGroup, type TestServer } from './servers.js';

export class Post extends Schema.Class<Post>('Post')({
  id: Schema.Number,
  title: Schema.String,
  createdAt: Schema.Date,
}) {
  get slug(): string {
    return this.title.toLowerCase().replaceAll(' ', '-');
  }
}

export class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.Number,
}) {}

export const appRouter = Router.make({
  post: {
    byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }),
    create: mutation({ payload: { title: Schema.String }, success: Post }),
  },
  countdown: subscription({ payload: { from: Schema.Number }, success: Schema.Number }),
});

const handlers = appRouter.group.toLayer({
  'post.byId': ({ id }) =>
    id === 1
      ? Effect.succeed(new Post({ id, title: 'Hello World', createdAt: new Date(2026, 0, 1) }))
      : Effect.fail(new PostNotFound({ id })),
  'post.create': ({ title }) => Effect.succeed(new Post({ id: 1, title, createdAt: new Date() })),
  countdown: ({ from }) => Stream.range(0, from).pipe(Stream.map((i) => from - i)),
});

const getToken = async (): Promise<string> => 'secret';

describe('README', () => {
  let server: TestServer;
  let wsServer: TestServer;

  beforeAll(async () => {
    server = await serveGroup(appRouter.group, handlers, { protocol: 'http' });
    wsServer = await serveGroup(appRouter.group, handlers, { protocol: 'websocket' });
  });

  afterAll(async () => {
    await server.dispose();
    await wsServer.dispose();
  });

  it('Promise client over HTTP', async () => {
    const client = createClient(appRouter, {
      link: httpLink({
        url: server.url,
        headers: async () => ({ authorization: `Bearer ${await getToken()}` }),
      }),
    });

    const post = await client.post.byId({ id: 1 });
    expect(post instanceof Post).toBe(true);
    expect(post.slug).toBe('hello-world');
    expect(post.createdAt.getFullYear()).toBe(2026);

    let missing: number | undefined;
    try {
      await client.post.byId({ id: 404 });
    } catch (cause) {
      const error = cause as Client.Error<typeof appRouter.record.post.byId>;
      switch (error._tag) {
        case 'PostNotFound':
          missing = error.id;
          break;
        case '@effect-trpc/RpcInterrupted':
        case '@effect-trpc/RpcTransportError':
        case '@effect-trpc/RpcDefect':
          throw error;
      }
    }
    expect(missing).toBe(404);

    const counted: Array<number> = [];
    for await (const n of client.countdown({ from: 3 })) counted.push(n);
    expect(counted).toEqual([3, 2, 1, 0]);

    const controller = new AbortController();
    const pending = client.post.byId(
      { id: 1 },
      { signal: controller.signal, headers: { 'x-trace': 'abc' } },
    );
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(RpcInterrupted);

    await client.dispose();
  });

  it('Effect client', async () => {
    const client = createClient(appRouter, { link: httpLink({ url: server.url }) });
    const title = client.$effect.post.byId({ id: 1 }).pipe(
      Effect.map((post) => post.title),
      Effect.catchTag('PostNotFound', (e) => Effect.succeed(`missing #${e.id}`)),
    );
    const ticks = Stream.runCollect(client.$effect.countdown({ from: 2 }));
    expect(await Effect.runPromise(title)).toBe('Hello World');
    expect(await Effect.runPromise(ticks)).toEqual([2, 1, 0]);
    await client.dispose();
  });

  it('localLink and wsLink', async () => {
    const local = createClient(appRouter, { link: localLink({ handlers }) });
    const live = createClient(appRouter, { link: wsLink({ url: wsServer.wsUrl }) });
    await expect(local.post.create({ title: 'Local' })).resolves.toBeInstanceOf(Post);
    await expect(live.post.byId({ id: 2 })).rejects.toBeInstanceOf(PostNotFound);
    await local.dispose();
    await live.dispose();
  });
});
