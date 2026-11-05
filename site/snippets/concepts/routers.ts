import { Effect, Layer, Schema } from 'effect';
import { RpcMiddleware } from 'effect/rpc';
import { mutation, query, Router, subscription } from '@effect-trpc/core';

// #region nesting
class User extends Schema.Class<User>('User')({ id: Schema.String, name: Schema.String }) {}
class UserNotFound extends Schema.TaggedError<UserNotFound>()('UserNotFound', {
  id: Schema.String,
}) {}

// A router is a nested record of procedures. Records nest freely, and so do routers.
const userRouter = Router.make({
  byId: query({ payload: { id: Schema.String }, success: User, error: UserNotFound }),
  rename: mutation({ payload: { id: Schema.String, name: Schema.String }, success: User }),
});

export const appRouter = Router.make({
  health: query({ success: Schema.Literal('ok') }), // no payload: called with no input
  user: userRouter, // a router inside a router
  admin: {
    stats: {
      count: query({ success: Schema.Number }), // tag "admin.stats.count"
    },
  },
  ticks: subscription({ payload: { every: Schema.Number }, success: Schema.Number }),
});
// #endregion nesting

// #region inspect
appRouter.procedures.get('user.byId')?.kind; // "query"
[...appRouter.procedures.keys()]; // ["health", "user.byId", "user.rename", "admin.stats.count", "ticks"]
appRouter.group; // an effect/rpc RpcGroup: works with RpcServer, RpcClient, RpcTest

const byIdRpc = Router.getRpc(appRouter, 'user.byId'); // precisely typed Rpc<"user.byId", …>
Router.getByPath(appRouter, ['user', 'byId']); // Option<ProcedureInfo>
Router.isPath(appRouter, ['admin', 'stats']); // true: a namespace
Router.isPath(appRouter, ['admin', 'nope']); // false
// #endregion inspect

// #region middleware
class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}
class Auth extends RpcMiddleware.Service<Auth>()('Auth', { error: Unauthorized }) {}
class Audit extends RpcMiddleware.Service<Audit>()('Audit') {}

const adminRouter = Router.make({
  // per procedure
  purge: mutation({ success: Schema.Number }).middleware(Audit),
  // …or for every procedure of a router: added after `Audit`, so it wraps it and runs first
}).middleware(Auth);
// inferError of `purge` now includes Unauthorized.
// #endregion middleware

// #region merge
const versionRouter = Router.make({ version: query({ success: Schema.String }) });
const merged = Router.merge(appRouter, versionRouter); // tags of both; overlapping keys throw
// #endregion merge

// #region reserved
try {
  Router.make({ then: query({ success: Schema.String }) });
} catch (error) {
  // Error: "then" is reserved: a router proxy with a `then` key looks like a Promise.
}
// #endregion reserved

void [byIdRpc, merged, adminRouter, Effect, Layer];
