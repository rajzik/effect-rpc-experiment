// A router written once as an Effect service, served with `Handlers.fromService` through
// `toWebHandler` and called with `createClient` + `httpLink`: class instances and typed errors are
// decoded on the client.
import { Context, Effect, Layer, Schema, Stream } from 'effect';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vite-plus/test';
import type { ClientError } from '@effect-trpc/core';
import { Procedure } from '@effect-trpc/core';
import type { Router } from '@effect-trpc/core';
import { createClient, httpLink } from '@effect-trpc/client';
import type { Client } from '@effect-trpc/client';
import { Handlers, toWebHandler } from '@effect-trpc/server';
import type { WebHandler } from '@effect-trpc/server';

class Post extends Schema.Class<Post>('Post')({
  id: Schema.Finite,
  title: Schema.String,
  createdAt: Schema.Date,
}) {
  headline(): string {
    return `#${this.id} ${this.title}`;
  }
}

class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.Finite,
}) {}

class Database extends Context.Service<
  Database,
  {
    readonly findPost: (id: number) => Effect.Effect<Post, PostNotFound>;
    readonly titles: Stream.Stream<string>;
  }
>()('Database') {}

const createdAt = new Date('2026-01-02T03:04:05.000Z');

const DatabaseLive = Layer.succeed(Database)({
  findPost: (id) =>
    id === 1
      ? Effect.succeed(new Post({ id, title: 'Hello', createdAt }))
      : Effect.fail(new PostNotFound({ id })),
  titles: Stream.make('first', 'second'),
});

class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.succeed({
    post: {
      byId: Procedure.input({ id: Schema.Finite })
        .output(Post)
        .error(PostNotFound)
        .query(
          Effect.fn(function* ({ id }) {
            const db = yield* Database;
            return yield* db.findPost(id);
          }),
        ),
      titles: Procedure.output(Schema.String).subscription(() =>
        Stream.unwrap(Effect.map(Database, (db) => db.titles)),
      ),
    },
  }),
}) {}

// Adapters take the class itself (normalised with `Router.from`, memoized `make`); type
// helpers take the router type `Router.Of<typeof AppRouter>`.
type AppRouterOf = Router.Of<typeof AppRouter>;

describe('router service: Handlers.fromService → toWebHandler → httpLink', () => {
  let web: WebHandler;
  let client: Client<AppRouterOf>;
  beforeAll(async () => {
    web = await toWebHandler(AppRouter, {
      handlers: Handlers.fromService(AppRouter).pipe(Layer.provide(DatabaseLive)),
    });
    client = createClient(AppRouter, {
      link: httpLink({
        url: 'http://localhost/rpc',
        fetch: (input, init) => web.handler(new Request(input, init)),
      }),
    });
  });
  afterAll(async () => {
    await client.dispose();
    await web.dispose();
  });

  it('decodes Schema.Class instances', async () => {
    const post = await client.post.byId({ id: 1 });
    expectTypeOf(post).toEqualTypeOf<Post>();
    expect(post).toBeInstanceOf(Post);
    expect(post.headline()).toBe('#1 Hello');
    expect(post.createdAt).toEqual(createdAt);
  });

  it('rejects with the typed error instance', async () => {
    const error = await client.post.byId({ id: 7 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PostNotFound);
    expectTypeOf<Client.Error<AppRouterOf['record']['post']['byId']>>().toEqualTypeOf<
      ClientError<PostNotFound>
    >();
  });

  it('streams subscription elements', async () => {
    const titles = await Effect.runPromise(Stream.runCollect(client.$effect.post.titles()));
    expect(titles).toEqual(['first', 'second']);
  });
});
