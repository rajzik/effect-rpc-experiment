import { Layer, Schema } from 'effect';
import { Router } from '@effect-trpc/core';
import { Handlers, toWebHandler } from '@effect-trpc/server';

import { Forbidden, Post, PostNotFound } from '@/router';
import { AppConfig, AppRouter as SourceAppRouter } from './router-service-effectful-inferred';
import { AppRouter as AppRouterContract } from './router-service-effectful-inferred.client.gen';
import type { Database } from './router-service';

// #region generated
// router.gen.ts (server): a lazy router service with the inferred schemas. Nothing runs at import.
// (The generated module names the import `__source_AppRouter`.)
export const AppRouter = Router.withSchemas(SourceAppRouter, {
  byId: { output: Post, error: PostNotFound },
  status: {
    output: Schema.Struct({ motd: Schema.String, readOnly: Schema.Boolean }),
    error: Forbidden,
  },
});
// #endregion generated

declare const AppConfigLive: Layer.Layer<AppConfig>;
declare const DatabaseLive: Layer.Layer<Database>;

// #region server
// server.ts: serve the generated service; `make` runs in the layer with the real services.
// Layer<Rpc.Handler<'byId'> | Rpc.Handler<'status'> | AppRouter, never, AppConfig | Database>
const HandlersLive = Handlers.fromService(AppRouter);

export const web = await toWebHandler(AppRouterContract, {
  handlers: HandlersLive.pipe(Layer.provide([AppConfigLive, DatabaseLive])),
});
// #endregion server
