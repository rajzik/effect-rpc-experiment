// Spike fixture: a router service with NO `.output(...)` / `.error(...)`. The generator infers
// both from each handler and writes `router.gen.ts` with them injected.
import { Context, Effect, Schema, Stream } from 'effect';
import { Procedure } from '@effect-trpc/core';

import { DbError, Forbidden, Post, PostNotFound } from './models.ts';

const posts = [
  new Post({ id: 1, title: 'Hello Effect', createdAt: new Date('2026-01-01') }),
  new Post({ id: 2, title: 'Typed errors', createdAt: new Date('2026-02-01') }),
];

export class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.succeed({
    health: Procedure.query(() => Effect.succeed('ok' as const)),
    post: {
      byId: Procedure.input({ id: Schema.Finite }).query(
        Effect.fn(function* ({ id }) {
          const post = posts.find((p) => p.id === id);
          if (post === undefined) return yield* new PostNotFound({ id });
          return post;
        }),
      ),
      list: Procedure.query(() =>
        Effect.succeed({ items: posts, nextCursor: posts.length > 1 ? 2 : null }),
      ),
      stats: Procedure.query(() =>
        Effect.succeed({ count: posts.length, latest: posts[0]?.createdAt, tags: ['a', 'b'] }),
      ),
      create: Procedure.input({ title: Schema.String }).mutation(
        Effect.fn(function* ({ title }) {
          if (title === '') return yield* new Forbidden({ reason: 'empty title' });
          if (title === 'db') return yield* new DbError({ query: 'insert' });
          return new Post({ id: posts.length + 1, title, createdAt: new Date() });
        }),
      ),
      onCreated: Procedure.subscription(() => Stream.fromIterable(posts)),
    },
  }),
}) {}
