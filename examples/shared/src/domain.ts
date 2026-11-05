/**
 * The task board's domain, shared by the server and every client: data classes, typed errors, the
 * `Auth` middleware declaration and the `appRouter`.
 *
 * Nothing here touches server state, so browsers and server components can import it freely. The
 * server side lives in `./server` (handlers and the `Auth` implementation) and `./store`.
 */
import { Context, Schema } from 'effect';
import { RpcMiddleware } from 'effect/rpc';
import { mutation, query, Router, subscription } from '@effect-trpc/core';

/** How many tasks `tasks.list` returns per page. */
export const PAGE_SIZE = 5;

/** A task. A `Schema.Class`, so clients receive real instances: `createdAt` is a `Date`. */
export class Task extends Schema.Class<Task>('Task')({
  id: Schema.Finite,
  title: Schema.String,
  done: Schema.Boolean,
  assignee: Schema.String,
  createdAt: Schema.Date,
  dueAt: Schema.optional(Schema.Date),
}) {
  /** Past its due date and not done yet. A getter: it only exists on decoded instances. */
  get isOverdue(): boolean {
    return !this.done && this.dueAt !== undefined && this.dueAt.getTime() < Date.now();
  }
}

/** One page of tasks. `nextCursor` is the cursor of the next page, `null` on the last one. */
export class TaskPage extends Schema.Class<TaskPage>('TaskPage')({
  items: Schema.Array(Task),
  nextCursor: Schema.NullOr(Schema.Finite),
}) {}

/** A signed-in user. Guests may read but not write. */
export class User extends Schema.Class<User>('User')({
  name: Schema.String,
  role: Schema.Literals(['member', 'guest']),
}) {}

/** No task has this id. */
export class TaskNotFound extends Schema.TaggedError<TaskNotFound>()('TaskNotFound', {
  id: Schema.Finite,
}) {}

/** The user may not do this (guests cannot write). */
export class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {
  reason: Schema.String,
}) {}

/** There is no (valid) session. */
export class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}

/** An input field is invalid. */
export class ValidationFailed extends Schema.TaggedError<ValidationFailed>()('ValidationFailed', {
  field: Schema.String,
  message: Schema.String,
}) {}

/** The signed-in user, provided to handlers by the `Auth` middleware. */
export class CurrentUser extends Context.Service<CurrentUser, User>()('CurrentUser') {}

/** Declared here (client-safe); implemented on the server by `makeServerLive`. */
export class Auth extends RpcMiddleware.Service<Auth, { provides: CurrentUser }>()('Auth', {
  error: Unauthorized,
}) {}

export const appRouter = Router.make({
  session: {
    me: query({ success: User }).middleware(Auth),
  },
  tasks: {
    // A `cursor` in the input enables `infiniteQueryOptions`.
    list: query({
      payload: { cursor: Schema.optional(Schema.NullOr(Schema.Finite)) },
      success: TaskPage,
    }),
    byId: query({ payload: { id: Schema.Finite }, success: Task, error: TaskNotFound }),
    create: mutation({
      payload: { title: Schema.String },
      success: Task,
      error: Schema.Union([Forbidden, ValidationFailed]),
    }).middleware(Auth),
    toggle: mutation({
      payload: { id: Schema.Finite },
      success: Task,
      error: Schema.Union([TaskNotFound, Forbidden]),
    }).middleware(Auth),
    onChanged: subscription({ success: Task }),
  },
  // Test-only: resets the in-memory data. Dies unless the server runs with `EXAMPLES_TEST=1`.
  testing: {
    reset: mutation({ success: Schema.Void }),
  },
});

export type AppRouter = typeof appRouter;
