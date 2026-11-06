// A router written without `.output` / `.error`: everything below is inferred.
import { Context, Effect, Schema, Stream } from 'effect';
import { Procedure, query, Router } from '@effect-trpc/core';

import { AdminRouter } from './admin.js';
import { db } from './db.js';
import { Auth, DbError, Forbidden, Log, Post, PostNotFound, Unauthorized } from './models.js';
import type { Tree } from './models.js';

// A local schema used as input: copied into the client module.
const PostById = Schema.Struct({ id: Schema.Finite });

const tree: Tree = { value: 1, children: [{ value: 2, children: [] }] };
const counts: Record<string, number> = { drafts: 1 };

export class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.succeed({
    health: Procedure.query(() => Effect.succeed('ok' as const)),
    post: {
      byId: Procedure.input(PostById).query(({ id }) => {
        const post = db.posts.find((p) => p.id === id);
        return post === undefined ? Effect.fail(new PostNotFound({ id })) : Effect.succeed(post);
      }),
      create: Procedure.input({ title: Schema.String })
        .middleware(Auth)
        .mutation(
          Effect.fn(function* ({ title }) {
            if (title === '') return yield* new Forbidden({ reason: 'empty title' });
            if (title === 'db') return yield* new DbError({ query: 'insert' });
            if (title === 'nope') return yield* new Unauthorized();
            return new Post({ id: db.posts.length + 1, title, createdAt: new Date() });
          }),
        ),
      onCreated: Procedure.subscription(() => Stream.fromIterable(db.posts)),
      // Explicit: copied as written.
      count: Procedure.output(Schema.Finite).query(() => Effect.succeed(db.posts.length)),
      // A user `.error`: kept and checked; only the output is inferred.
      first: Procedure.error(PostNotFound).query(() => {
        const post = db.posts[0];
        return post === undefined ? Effect.fail(new PostNotFound({ id: 0 })) : Effect.succeed(post);
      }),
    },
    data: {
      tree: Procedure.query(() => Effect.succeed(tree)),
      stats: Procedure.query(() =>
        Effect.succeed({
          total: BigInt(db.posts.length),
          tags: new Set(['effect']),
          byAuthor: new Map([['ada', 2]]),
          counts,
          latest: db.posts[0]?.createdAt,
          titles: db.posts.map((p) => p.title),
        }),
      ),
      ping: Procedure.mutation(() => Effect.void),
    },
    admin: AdminRouter,
    logged: Router.make({ ping: Procedure.query(() => Effect.succeed('pong')) }).middleware(Log),
  }),
}) {}

// A schema-only router: copied to the client as is.
export const StatusRouter = Router.make({
  status: query({ success: Schema.Literal('up') }),
});
