import { Router } from '@effect-trpc/core';

import { Forbidden, Post, PostNotFound } from '@/router';
import { AppRouter as SourceAppRouter } from './router-service-inferred';

// #region generated
// router.gen.ts (server): the router module with the inferred schemas. Serve this one.
// (The generated module names the import `__source_AppRouter`.)
export const AppRouter = Router.withSchemas(SourceAppRouter, {
  byId: { output: Post, error: PostNotFound },
  create: { output: Post, error: Forbidden }, // DbError is not a schema: a defect
});
// #endregion generated
