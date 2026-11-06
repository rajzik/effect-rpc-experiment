import { Context, Data, Effect, Schema } from 'effect';
import { Procedure } from '@effect-trpc/core';
import type { inferOutput, Router } from '@effect-trpc/core';

import { Forbidden, Post, PostNotFound } from '@/router';

const posts = [new Post({ id: 1, title: 'Hello Effect', createdAt: new Date('2026-01-01') })];

class DbError extends Data.TaggedError('DbError')<{ readonly query: string }> {}

// #region written
// router.ts: no `.output` / `.error`. The types come from the handlers.
export class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.succeed({
    byId: Procedure.input({ id: Schema.Finite }).query(
      Effect.fn(function* ({ id }) {
        const post = posts.find((p) => p.id === id);
        if (post === undefined) return yield* new PostNotFound({ id });
        return post;
      }),
    ),
    create: Procedure.input({ title: Schema.String }).mutation(
      Effect.fn(function* ({ title }) {
        if (title === '') return yield* new Forbidden({ reason: 'empty title' });
        if (title === 'db') return yield* new DbError({ query: 'insert' });
        return new Post({ id: 2, title, createdAt: new Date() });
      }),
    ),
  }),
}) {}

type ById = inferOutput<Router.Of<typeof AppRouter>['record']['byId']>; // Post
// #endregion written

export type { ById };
