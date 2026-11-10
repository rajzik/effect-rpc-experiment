// router.ts — the quick start router, written once as an Effect service. The handlers live next to
// the schemas, so there is no separate `Handlers.make`.
import { Context, Effect, Layer, Schema, Stream } from 'effect';
import { NodeRuntime } from '@effect/platform-node';
import { Procedure } from '@rpc-effect/core';
import { Handlers } from '@rpc-effect/server';
import { serve } from '@rpc-effect/server/node';

import { Auth, CurrentUser, Forbidden, Post, PostNotFound, PostPage } from '@/router';
import { AuthLive } from '@/server'; // the Auth middleware implementation

const posts = [
  new Post({ id: 1, title: 'Hello Effect', createdAt: new Date('2026-01-01') }),
  new Post({ id: 2, title: 'Typed errors', createdAt: new Date('2026-02-01') }),
  new Post({ id: 3, title: 'Schema classes', createdAt: new Date('2026-03-01') }),
];

// #region router
export class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.succeed({
    health: Procedure.output(Schema.Literal('ok')).query(() => Effect.succeed('ok' as const)),
    post: {
      byId: Procedure.input({ id: Schema.Finite })
        .output(Post)
        .error(PostNotFound)
        .query(({ id }) => {
          const post = posts.find((p) => p.id === id);
          return post ? Effect.succeed(post) : Effect.fail(new PostNotFound({ id }));
        }),
      list: Procedure.input({ cursor: Schema.optional(Schema.NullOr(Schema.Finite)) })
        .output(PostPage)
        .query(({ cursor }) => {
          const start = cursor ?? 0;
          const items = posts.slice(start, start + 2);
          const next = start + 2 < posts.length ? start + 2 : null;
          return Effect.succeed(new PostPage({ items, nextCursor: next }));
        }),
      create: Procedure.input({ title: Schema.String })
        .output(Post)
        .error(Forbidden)
        .middleware(Auth)
        .mutation(
          Effect.fn(function* ({ title }) {
            const user = yield* CurrentUser; // provided by Auth
            if (user.name === 'guest')
              return yield* new Forbidden({ reason: 'guests cannot post' });
            return new Post({ id: posts.length + 1, title, createdAt: new Date() });
          }),
        ),
      onCreated: Procedure.output(Post).subscription(() => Stream.fromIterable(posts)),
    },
  }),
}) {}
// #endregion router

// #region serve
// No services to provide: the handlers only touch the in-memory `posts`.
const ServerLive = Layer.mergeAll(Handlers.fromService(AppRouter), AuthLive);

Layer.launch(serve(AppRouter, { handlers: ServerLive, port: 3000 })).pipe(NodeRuntime.runMain);
// #endregion serve
