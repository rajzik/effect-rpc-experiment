import { Context, Data, Effect, Schema } from 'effect';
import { mutation, Procedure, query, Router } from '@effect-trpc/core';
import type { inferError, inferOutput } from '@effect-trpc/core';

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

// #region generated
// router.gen.ts (server): the router module with the inferred schemas. Serve this one.
export const ServerRouter = Router.withSchemas(AppRouter, {
  byId: { output: Post, error: PostNotFound },
  create: { output: Post, error: Forbidden }, // DbError is not a schema: a defect
});
// #endregion generated

// #region client
// router.client.gen.ts (clients): the same contract, schemas only. No handlers, no router import.
export const ClientRouter = Router.make({
  byId: query({ payload: { id: Schema.Finite }, success: Post, error: PostNotFound }),
  create: mutation({ payload: { title: Schema.String }, success: Post, error: Forbidden }),
});

type CreateError = inferError<typeof ClientRouter.record.create>; // Forbidden
// #endregion client

export type { ById, CreateError };
