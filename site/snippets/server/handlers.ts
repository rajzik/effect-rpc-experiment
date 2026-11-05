import { Context, Effect, Layer, Stream } from 'effect';
import { Handlers } from '@effect-trpc/server';

import { appRouter, Forbidden, Post, PostNotFound, PostPage } from '@/router';

// #region service
// Handlers depend on services like any Effect code.
export class PostRepo extends Context.Service<
  PostRepo,
  {
    readonly find: (id: number) => Effect.Effect<Post, PostNotFound>;
    readonly page: (cursor: number) => Effect.Effect<PostPage>;
    readonly insert: (title: string) => Effect.Effect<Post>;
  }
>()('PostRepo') {}
// #endregion service

// #region record
// A record mirroring the router. Each handler is `(payload, ctx) => Effect` (or Stream).
export const HandlersLive = Handlers.make(appRouter, {
  health: () => Effect.succeed('ok' as const),
  post: {
    byId: ({ id }) =>
      Effect.gen(function* () {
        const repo = yield* PostRepo; // a requirement of the handler layer
        return yield* repo.find(id);
      }),
    list: ({ cursor }) =>
      Effect.gen(function* () {
        const repo = yield* PostRepo;
        return yield* repo.page(cursor ?? 0);
      }),
    create: ({ title }, { headers }) =>
      Effect.gen(function* () {
        if (headers['x-read-only'] === 'true') {
          return yield* new Forbidden({ reason: 'read-only mode' });
        }
        const repo = yield* PostRepo;
        return yield* repo.insert(title);
      }),
    onCreated: () => Stream.empty,
  },
});
// HandlersLive: Layer<handlers, never, PostRepo> — PostRepo is still required.
// #endregion record

// #region build
// Or resolve services once, when the layer is built. `Handlers.of` keeps contextual typing.
export const HandlersFromRepo = Handlers.make(
  appRouter,
  Effect.gen(function* () {
    const repo = yield* PostRepo;
    return Handlers.of(appRouter, {
      health: () => Effect.succeed('ok' as const),
      post: {
        byId: ({ id }) => repo.find(id),
        list: ({ cursor }) => repo.page(cursor ?? 0),
        create: ({ title }) => repo.insert(title),
        onCreated: () => Stream.empty,
      },
    });
  }),
);
// #endregion build

// #region flat
// The tag-keyed form, as effect/rpc's `group.toLayer` takes it.
export const FlatHandlers = Handlers.flat(appRouter, {
  health: () => Effect.succeed('ok' as const),
  'post.byId': ({ id }) => Effect.fail(new PostNotFound({ id })),
  'post.list': () => Effect.succeed(new PostPage({ items: [], nextCursor: null })),
  'post.create': ({ title }) => Effect.succeed(new Post({ id: 1, title, createdAt: new Date() })),
  'post.onCreated': () => Stream.empty,
});
// #endregion flat

// #region provide
const PostRepoLive = Layer.succeed(PostRepo)({
  find: (id) => Effect.fail(new PostNotFound({ id })),
  page: () => Effect.succeed(new PostPage({ items: [], nextCursor: null })),
  insert: (title) => Effect.succeed(new Post({ id: 1, title, createdAt: new Date() })),
});

// Provide services before handing the layer to an adapter: adapters need no requirements left.
export const HandlersReady = HandlersLive.pipe(Layer.provide(PostRepoLive));
// #endregion provide
