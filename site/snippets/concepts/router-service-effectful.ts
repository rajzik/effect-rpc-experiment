import { Context, Effect, Layer, Schema } from 'effect';
import { Procedure, query, Router } from '@effect-trpc/core';
import { createClient, httpLink } from '@effect-trpc/client';
import { Handlers, toWebHandler } from '@effect-trpc/server';

import { Post, PostNotFound } from '@/router';
import { Database } from './router-service';

// #region service
export class AppConfig extends Context.Service<AppConfig, { readonly maxPostId: number }>()(
  'AppConfig',
) {}

// router.ts: `make` reads services, so it runs inside the server layer, once per build.
export class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const db = yield* Database;
    return {
      post: {
        byId: Procedure.input({ id: Schema.Finite })
          .output(Post)
          .error(PostNotFound)
          .query(({ id }) =>
            id > cfg.maxPostId ? Effect.fail(new PostNotFound({ id })) : db.findPost(id),
          ),
      },
    };
  }),
}) {}
// #endregion service

// #region contract
// The schema-only contract the synchronous APIs take (codegen writes it as router.client.gen.ts).
export const AppRouterContract = Router.make({
  post: { byId: query({ payload: { id: Schema.Finite }, success: Post, error: PostNotFound }) },
});

// Written by hand: check it against the class, as codegen does. This fails to compile when the
// contract drifts from the class (a schema, a procedure or a `.middleware(...)` it misses).
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const contractMatchesRouter: Same<
  Router.Rpcs<typeof AppRouterContract>,
  Router.Rpcs<typeof AppRouter>
> = true;
// #endregion contract

declare const AppConfigLive: Layer.Layer<AppConfig>;
declare const DatabaseLive: Layer.Layer<Database>;

// #region server
// Layer<Rpc.Handler<'post.byId'> | AppRouter, never, AppConfig | Database>
const HandlersLive = Handlers.fromService(AppRouter);

// The class goes to Handlers.fromService; everything else takes the contract.
export const web = await toWebHandler(AppRouterContract, {
  handlers: HandlersLive.pipe(Layer.provide([AppConfigLive, DatabaseLive])),
});
// #endregion server

// #region client
const client = createClient(AppRouterContract, {
  link: httpLink({ url: 'http://localhost:3000/rpc' }),
});
const post = await client.post.byId({ id: 1 }); // a decoded Post
// #endregion client

export { post };
