import { Effect, Layer, Stream } from 'effect';
import { createClient, localLink } from '@effect-trpc/client';
import { Handlers } from '@effect-trpc/server';
import { effectExpect, effectIt, testCaller } from '@effect-trpc/test-utils';

import { appRouter, Post, PostNotFound, PostPage } from '@/router';
import { AuthLive, ServerLive } from '@/server';

// #region caller
effectIt.effect('byId returns the post', () =>
  Effect.gen(function* () {
    // The caller's Effect API: the error channel is exactly the procedure's errors.
    const caller = testCaller(appRouter, ServerLive);
    const post = yield* caller.post.byId({ id: 1 });
    effectExpect(post).toBeInstanceOf(Post);

    const missing = yield* Effect.flip(caller.post.byId({ id: 404 }));
    effectExpect(missing._tag).toBe('PostNotFound');
  }),
);
// #endregion caller

// #region headers
effectIt.effect('create needs a signed-in user', () =>
  Effect.gen(function* () {
    const caller = testCaller(appRouter, ServerLive);
    const created = yield* caller.post.create(
      { title: 'Hello' },
      { headers: { authorization: 'Bearer ada' } },
    );
    effectExpect(created.title).toBe('Hello');

    const guest = yield* Effect.flip(
      caller.post.create({ title: 'x' }, { headers: { authorization: 'Bearer guest' } }),
    );
    effectExpect(guest._tag).toBe('Forbidden');
  }),
);
// #endregion headers

// #region fake
// Code under test takes a client; tests hand it one over localLink with fake handlers.
const FakeHandlers = Handlers.make(appRouter, {
  health: () => Effect.succeed('ok' as const),
  post: {
    byId: ({ id }) => Effect.fail(new PostNotFound({ id })), // every post is missing
    list: () => Effect.succeed(new PostPage({ items: [], nextCursor: null })),
    create: ({ title }) => Effect.succeed(new Post({ id: 99, title, createdAt: new Date(0) })),
    onCreated: () => Stream.empty,
  },
});

effectIt.effect('the UI copes with a missing post', () =>
  Effect.gen(function* () {
    const client = createClient(appRouter, {
      link: localLink({ handlers: Layer.merge(FakeHandlers, AuthLive) }),
    });
    const error = yield* Effect.flip(client.$effect.post.byId({ id: 1 }));
    effectExpect(error._tag).toBe('PostNotFound');
    yield* Effect.promise(() => client.dispose());
  }),
);
// #endregion fake
