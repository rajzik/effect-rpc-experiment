import { Context, Effect, Schema } from 'effect';
import { Procedure } from '@effect-trpc/core';
import type { inferOutput, Router } from '@effect-trpc/core';

import { Forbidden } from '@/router';
import { Database } from './router-service';

// #region written
export class AppConfig extends Context.Service<
  AppConfig,
  { readonly motd: string; readonly readOnly: boolean }
>()('AppConfig') {}

// router.ts: `make` reads services, and no procedure declares `.output` / `.error`.
export class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const db = yield* Database;
    return {
      // Effect<Post, PostNotFound>: from Database.findPost
      byId: Procedure.input({ id: Schema.Finite }).query(({ id }) => db.findPost(id)),
      // Effect<{ readonly motd: string; readonly readOnly: boolean }, Forbidden>
      status: Procedure.query(
        Effect.fn(function* () {
          if (cfg.motd === '') return yield* new Forbidden({ reason: 'no message of the day' });
          return { motd: cfg.motd, readOnly: cfg.readOnly };
        }),
      ),
    };
  }),
}) {}

type ById = inferOutput<Router.Of<typeof AppRouter>['record']['byId']>; // Post
// #endregion written

export type { ById };
