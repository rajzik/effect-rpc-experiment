// Mirrors the example in README.md so the documentation stays correct.
import { Context, Effect, Layer, Schema, Stream } from 'effect';
import { mutation, Procedure, query, Router, subscription } from '@effect-trpc/core';
import type { ClientError } from '@effect-trpc/core';
import { describe, expect, expectTypeOf, it } from 'vite-plus/test';
import { createCaller, Handlers, Middleware, toWebHandler } from '../src/index.js';
import { runServer } from '../src/node.js';
import { rejection } from './fixtures.js';
import { readFrames, rpcRequest } from './wire.js';

class User extends Schema.Class<User>('User')({
  id: Schema.String,
  name: Schema.String,
  createdAt: Schema.Date,
}) {
  greet() {
    return `Hello, ${this.name}!`;
  }
}
class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { id: Schema.String }) {}
class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}

class CurrentUser extends Context.Service<CurrentUser, { readonly name: string }>()(
  'CurrentUser',
) {}
class Auth extends Middleware.make<Auth, { provides: CurrentUser }>()('Auth', {
  error: Unauthorized,
}) {}

const AuthLive = Layer.succeed(Auth)(
  Auth.of((effect, { headers }) => {
    const name = headers['x-user'];
    return name === undefined
      ? Effect.fail(new Unauthorized())
      : Effect.provideService(effect, CurrentUser, { name });
  }),
);

const appRouter = Router.make({
  user: {
    byId: query({ payload: { id: Schema.String }, success: User, error: NotFound }),
    create: mutation({ payload: { name: Schema.String }, success: User }),
    me: query({ success: User }).middleware(Auth),
    list: subscription({ payload: { count: Schema.Finite }, success: User }),
  },
});

const HandlersLive = Handlers.make(appRouter, {
  user: {
    byId: ({ id }) =>
      id === 'ada'
        ? Effect.succeed(new User({ id, name: 'Ada', createdAt: new Date() }))
        : Effect.fail(new NotFound({ id })),
    create: ({ name }) => Effect.succeed(new User({ id: name, name, createdAt: new Date() })),
    me: () =>
      Effect.gen(function* () {
        const { name } = yield* CurrentUser;
        return new User({ id: name, name, createdAt: new Date() });
      }),
    list: ({ count }) =>
      Stream.range(1, count).pipe(
        Stream.map((i) => new User({ id: `u${i}`, name: `User ${i}`, createdAt: new Date() })),
      ),
  },
});

const ServerLive = Layer.mergeAll(HandlersLive, AuthLive);

describe('README example', () => {
  it('fetch handler', async () => {
    const { handler, dispose } = await toWebHandler(appRouter, { handlers: ServerLive });
    try {
      const response = await handler(
        rpcRequest([{ tag: 'user.me' }], { headers: { 'x-user': 'grace' } }),
      );
      const frames = await readFrames(response);
      expect(frames[0]?.exit).toMatchObject({ _tag: 'Success', value: { name: 'grace' } });
    } finally {
      await dispose();
    }
  });

  it('in-process caller', async () => {
    const caller = createCaller(appRouter, { handlers: ServerLive });
    try {
      const ada = await caller.$promise.user.byId({ id: 'ada' });
      expect(ada).toBeInstanceOf(User);
      expect(ada.greet()).toBe('Hello, Ada!');

      const me = await caller.$promise.user.me(undefined, { headers: { 'x-user': 'grace' } });
      expect(me.name).toBe('grace');

      const error = await rejection(caller.$promise.user.byId({ id: 'nobody' }));
      expect(error).toBeInstanceOf(NotFound);
      expectTypeOf<ClientError<NotFound>>().toExtend<NotFound | { readonly _tag: string }>();

      const program = caller.user
        .byId({ id: 'nobody' })
        .pipe(Effect.catchTag('NotFound', () => Effect.succeed(null)));
      expectTypeOf(program).toEqualTypeOf<Effect.Effect<User | null>>();
      expect(await Effect.runPromise(program)).toBeNull();

      const greetings: Array<string> = [];
      for await (const user of caller.$promise.user.list({ count: 3 })) {
        greetings.push(user.greet());
      }
      expect(greetings).toHaveLength(3);
    } finally {
      await caller.dispose();
    }
  });

  it('node server', async () => {
    const server = await runServer(appRouter, { handlers: ServerLive, port: 0 });
    try {
      expect(server.url).toMatch(/^http:\/\/localhost:\d+\/rpc$/);
      const response = await fetch(
        rpcRequest([{ tag: 'user.byId', payload: { id: 'ada' } }], { url: server.url }),
      );
      expect((await readFrames(response))[0]?.exit).toMatchObject({
        _tag: 'Success',
        value: { name: 'Ada' },
      });
    } finally {
      await server.dispose();
    }
  });
});

describe('README: routers as services', () => {
  class Post extends Schema.Class<Post>('Post')({ id: Schema.Finite, title: Schema.String }) {}
  class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
    id: Schema.Finite,
  }) {}
  class Database extends Context.Service<
    Database,
    { readonly findPost: (id: number) => Effect.Effect<Post, PostNotFound> }
  >()('Database') {}
  // `Auth`, `CurrentUser` and `AuthLive` as in the README example above.

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
      },
      me: Procedure.output(Schema.String)
        .middleware(Auth)
        .query(() => Effect.map(CurrentUser, (user) => user.name)),
    }),
  }) {}

  const DatabaseLive = Layer.succeed(Database)({
    findPost: (id) =>
      id === 1
        ? Effect.succeed(new Post({ id, title: 'Hello' }))
        : Effect.fail(new PostNotFound({ id })),
  });
  it('Handlers.fromService with createCaller', async () => {
    const ServiceHandlersLive = Handlers.fromService(AppRouter);
    expectTypeOf(ServiceHandlersLive).toExtend<Layer.Layer<AppRouter, never, Database>>();
    const ServiceServerLive = Layer.mergeAll(ServiceHandlersLive, AuthLive).pipe(
      Layer.provide(DatabaseLive),
    );
    await using caller = createCaller(AppRouter, { handlers: ServiceServerLive });
    expect(await caller.$promise.post.byId({ id: 1 })).toBeInstanceOf(Post);
    expect(await caller.$promise.me(undefined, { headers: { 'x-user': 'ada' } })).toBe('ada');
  });
});
