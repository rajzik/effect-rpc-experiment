import { Schema } from 'effect';
import { mutation, query, Router } from '@effect-trpc/core';
import type { inferError } from '@effect-trpc/core';

import { Forbidden, Post, PostNotFound } from '@/router';

// #region client
// router.client.gen.ts (clients): the same contract, schemas only. No handlers, no router import.
export const AppRouter = Router.make({
  byId: query({ payload: { id: Schema.Finite }, success: Post, error: PostNotFound }),
  create: mutation({ payload: { title: Schema.String }, success: Post, error: Forbidden }),
});

type CreateError = inferError<typeof AppRouter.record.create>; // Forbidden
// #endregion client

export type { CreateError };
