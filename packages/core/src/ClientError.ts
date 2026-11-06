/**
 * The client error model: every failed client call collapses to one {@link ClientError}.
 *
 * A procedure's own typed error `E` (its `Schema.TaggedError` union) is kept apart from the three
 * infrastructure errors defined here — {@link RpcDefect}, {@link RpcTransportError} and
 * {@link RpcInterrupted}. `@effect-trpc/client`, `@effect-trpc/server`'s caller and
 * `@effect-trpc/tanstack-react-query` use {@link causeToClientError} to turn an `effect/rpc`
 * `Cause` into the value a Promise rejects with.
 *
 * @since 0.1.0
 */
import { Cause, Exit, Option, Predicate, Schema } from 'effect';
import type { RpcClientError } from 'effect/rpc';

/**
 * The server died: an unexpected defect (`Effect.die`, a thrown exception, ...) instead of a
 * declared typed error.
 *
 * **When to use**
 *
 * Match on it (`instanceof RpcDefect` or `_tag === '@effect-trpc/RpcDefect'`) to tell "the
 * handler crashed" apart from the procedure's declared errors. You never construct it yourself
 * outside of tests; {@link causeToClientError} builds it from a `Die` cause.
 *
 * **Details**
 *
 * - `_tag` is `'@effect-trpc/RpcDefect'`.
 * - `message` is `defect.message` when the defect has a string `message`, else `String(defect)`.
 * - `cause` holds the original defect (encoded with `Schema.Defect`, so it survives JSON).
 *
 * **Gotchas**
 *
 * - The server keeps serving after a defect; only the one call fails.
 * - Do not declare `RpcDefect` in a procedure's `error` schema: it is added by the client.
 *
 * **Example** (Telling a crash apart from a domain error)
 *
 * ```ts
 * import { Cause, Schema } from 'effect';
 * import { causeToClientError, RpcDefect } from '@effect-trpc/core';
 *
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const error = causeToClientError<PostNotFound>(Cause.die(new Error('database exploded')));
 * if (error instanceof RpcDefect) {
 *   console.error(error.message); // "database exploded"
 * }
 * ```
 *
 * @see {@link causeToClientError}
 * @see {@link ClientError}
 * @category errors
 * @since 0.1.0
 */
export class RpcDefect extends Schema.TaggedError<RpcDefect>()('@effect-trpc/RpcDefect', {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/**
 * The request could not be delivered or the response could not be read (network, HTTP status,
 * socket, protocol).
 *
 * **When to use**
 *
 * Match on it to retry, show an "offline" state or report connectivity problems, separately from
 * domain errors and server crashes.
 *
 * **Details**
 *
 * - `_tag` is `'@effect-trpc/RpcTransportError'`.
 * - {@link causeToClientError} builds it from a `Fail(RpcClientError)`: `message` is the
 *   original error's message and `cause` the original `RpcClientError` from `effect/rpc`.
 *
 * **Example** (Retrying only transport failures)
 *
 * ```ts
 * import { RpcTransportError } from '@effect-trpc/core';
 *
 * declare const call: () => Promise<string>;
 *
 * const withRetry = async (): Promise<string> => {
 *   try {
 *     return await call();
 *   } catch (error) {
 *     // domain errors and defects are not retried
 *     if (error instanceof RpcTransportError) return call();
 *     throw error;
 *   }
 * };
 * ```
 *
 * @see {@link isRpcClientError}
 * @see {@link ClientError}
 * @category errors
 * @since 0.1.0
 */
export class RpcTransportError extends Schema.TaggedError<RpcTransportError>()(
  '@effect-trpc/RpcTransportError',
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/**
 * The call was interrupted (aborted by the caller, or interrupted on the server).
 *
 * **When to use**
 *
 * Match on it to ignore cancelled calls (an unmounted component, a superseded request) instead of
 * reporting them as failures.
 *
 * **Details**
 *
 * - `_tag` is `'@effect-trpc/RpcInterrupted'`; it carries no fields.
 * - {@link causeToClientError} returns it only when the cause has neither a typed failure nor a
 *   defect.
 *
 * **Example** (Ignoring aborted calls)
 *
 * ```ts
 * import { RpcInterrupted } from '@effect-trpc/core';
 *
 * const report = (error: unknown): void => {
 *   if (error instanceof RpcInterrupted) return; // the caller aborted; nothing to report
 *   console.error(error);
 * };
 * ```
 *
 * @see {@link ClientError}
 * @category errors
 * @since 0.1.0
 */
export class RpcInterrupted extends Schema.TaggedError<RpcInterrupted>()(
  '@effect-trpc/RpcInterrupted',
  {},
) {}

/**
 * The infrastructure errors every client call may fail with, in addition to the procedure's `E`.
 *
 * **Details**
 *
 * - Equal to `ClientError<never>`.
 * - {@link isClientInfrastructureError} narrows an unknown value to this union.
 *
 * **Example** (Handling only infrastructure failures)
 *
 * ```ts
 * import type { ClientInfrastructureError } from '@effect-trpc/core';
 *
 * const describe = (error: ClientInfrastructureError): string => {
 *   switch (error._tag) {
 *     case '@effect-trpc/RpcDefect':
 *       return `server crashed: ${error.message}`;
 *     case '@effect-trpc/RpcTransportError':
 *       return `network: ${error.message}`;
 *     case '@effect-trpc/RpcInterrupted':
 *       return 'cancelled';
 *   }
 * };
 * ```
 *
 * @see {@link ClientError}
 * @category models
 * @since 0.1.0
 */
export type ClientInfrastructureError = RpcDefect | RpcTransportError | RpcInterrupted;

/**
 * The error a client call rejects / fails with: the procedure's own typed error `E`, or one of
 * the infrastructure errors.
 *
 * **When to use**
 *
 * Use it to type `catch` handlers, `onError` callbacks and React Query `error` values for a
 * procedure whose typed error is `E` (e.g. `ClientError<inferError<typeof byId>>`).
 *
 * **Details**
 *
 * - `ClientError<E> = E | RpcDefect | RpcTransportError | RpcInterrupted`.
 * - Domain errors are never disguised as infrastructure errors and vice versa: a declared error
 *   arrives as the same `Schema.TaggedError` instance the handler failed with.
 * - Every member has a `_tag`, so a `switch (error._tag)` is exhaustive.
 *
 * **Example** (Exhaustively handling a call's error)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import type { ClientError } from '@effect-trpc/core';
 *
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const message = (error: ClientError<PostNotFound>): string => {
 *   switch (error._tag) {
 *     case 'PostNotFound':
 *       return `post ${error.id} does not exist`;
 *     case '@effect-trpc/RpcDefect':
 *       return 'the server crashed';
 *     case '@effect-trpc/RpcTransportError':
 *       return 'you seem to be offline';
 *     case '@effect-trpc/RpcInterrupted':
 *       return 'cancelled';
 *   }
 * };
 * ```
 *
 * @see {@link causeToClientError}
 * @see {@link isClientInfrastructureError}
 * @category models
 * @since 0.1.0
 */
export type ClientError<E> = E | RpcDefect | RpcTransportError | RpcInterrupted;

const infrastructureTags: ReadonlySet<string> = new Set([
  '@effect-trpc/RpcDefect',
  '@effect-trpc/RpcTransportError',
  '@effect-trpc/RpcInterrupted',
]);

const RpcClientErrorTypeId = '~effect/rpc/RpcClientError';

/**
 * Returns `true` for `RpcClientError` (the `effect/rpc` transport/protocol error).
 *
 * **When to use**
 *
 * Use when you work with a raw `effect/rpc` `RpcClient` and need to tell its transport failures
 * apart from the procedure's typed errors. Prefer {@link causeToClientError}, which already maps
 * them to {@link RpcTransportError}.
 *
 * **Details**
 *
 * - Checks the `effect/rpc` type id, so it does not match an {@link RpcTransportError}.
 *
 * **Example** (Classifying a raw rpc failure)
 *
 * ```ts
 * import { isRpcClientError } from '@effect-trpc/core';
 *
 * declare const failure: unknown;
 *
 * const kind = isRpcClientError(failure) ? 'transport' : 'domain';
 * ```
 *
 * @see {@link RpcTransportError}
 * @category guards
 * @since 0.1.0
 */
export const isRpcClientError = (u: unknown): u is RpcClientError.RpcClientError =>
  Predicate.hasProperty(u, RpcClientErrorTypeId);

/**
 * Returns `true` for `RpcDefect`, `RpcTransportError` and `RpcInterrupted`.
 *
 * **When to use**
 *
 * Use to split a {@link ClientError} into "infrastructure" and "my procedure's error `E`": on a
 * `ClientError<E>` the `false` branch narrows to `E`.
 *
 * **Details**
 *
 * - Discriminates on `_tag`, so it also recognizes errors that crossed a serialization boundary
 *   (e.g. `JSON.parse(JSON.stringify(new RpcInterrupted()))`).
 *
 * **Example** (Narrowing a client error to the domain error)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { isClientInfrastructureError } from '@effect-trpc/core';
 * import type { ClientError } from '@effect-trpc/core';
 *
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const render = (error: ClientError<PostNotFound>): string =>
 *   isClientInfrastructureError(error)
 *     ? `infrastructure: ${error._tag}`
 *     : `not found: ${error.id}`; // error: PostNotFound
 * ```
 *
 * @see {@link ClientInfrastructureError}
 * @category guards
 * @since 0.1.0
 */
export const isClientInfrastructureError = (u: unknown): u is ClientInfrastructureError =>
  Predicate.hasProperty(u, '_tag') && typeof u._tag === 'string' && infrastructureTags.has(u._tag);

const defectMessage = (defect: unknown): string => {
  if (defect instanceof Error) return defect.message;
  if (Predicate.hasProperty(defect, 'message') && typeof defect.message === 'string') {
    return defect.message;
  }
  try {
    return String(defect);
  } catch {
    return 'Unknown defect';
  }
};

/**
 * Collapses the `Cause` of a failed client call into a single {@link ClientError}.
 *
 * **When to use**
 *
 * Use when you call an `effect/rpc` client (or `RpcTest.makeClient(router.group)`) directly and
 * want the same error a Promise client would reject with. The effect-trpc clients and the
 * TanStack Query bridge already apply it.
 *
 * **Details**
 *
 * - `Fail(e)` where `e` is an `RpcClientError` → `RpcTransportError` (cause = the original error)
 * - `Fail(e)` otherwise → `e` itself (the same instance)
 * - `Die(defect)` → `RpcDefect` (message from `defect.message` or `String(defect)`)
 * - interruption only → `RpcInterrupted`
 * - Typed failures take precedence over defects, defects over interruption (like `Cause.squash`).
 * - An empty cause becomes an `RpcDefect` ("The call failed with an empty cause").
 *
 * **Example** (Classifying the failure of an in-memory rpc call)
 *
 * ```ts
 * import { Effect, Exit, Schema } from 'effect';
 * import { RpcTest } from 'effect/rpc';
 * import { causeToClientError, isClientInfrastructureError, query, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 *
 * const HandlersLive = appRouter.group.toLayer({
 *   'post.byId': ({ id }) => Effect.fail(new PostNotFound({ id })),
 * });
 *
 * const program = Effect.gen(function* () {
 *   const client = yield* RpcTest.makeClient(appRouter.group);
 *   const exit = yield* Effect.exit(client['post.byId']({ id: 7 }));
 *   if (Exit.isSuccess(exit)) return exit.value.title;
 *   const error = causeToClientError(exit.cause); // ClientError<PostNotFound>
 *   return isClientInfrastructureError(error) ? error._tag : `not found: ${error.id}`;
 * });
 *
 * const result = await Effect.runPromise(
 *   program.pipe(Effect.scoped, Effect.provide(HandlersLive)),
 * ); // "not found: 7"
 * ```
 *
 * @see {@link exitToClientError}
 * @see {@link ClientError}
 * @category errors
 * @since 0.1.0
 */
export const causeToClientError = <E>(
  cause: Cause.Cause<E | RpcClientError.RpcClientError>,
): ClientError<Exclude<E, RpcClientError.RpcClientError>> => {
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) {
      const error = reason.error;
      if (isRpcClientError(error)) {
        return new RpcTransportError({ message: error.message, cause: error });
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the guard above excluded RpcClientError; TS cannot narrow a generic `E`
      return error as Exclude<E, RpcClientError.RpcClientError>;
    }
  }
  for (const reason of cause.reasons) {
    if (Cause.isDieReason(reason)) {
      return new RpcDefect({ message: defectMessage(reason.defect), cause: reason.defect });
    }
  }
  if (cause.reasons.length > 0) {
    return new RpcInterrupted();
  }
  return new RpcDefect({ message: 'The call failed with an empty cause', cause: undefined });
};

/**
 * Returns the {@link ClientError} of a failed exit, or `Option.none()` for a successful one.
 *
 * **When to use**
 *
 * Use when you already hold an `Exit` (from `Effect.runPromiseExit`, `Effect.exit` or a decoded
 * `Codecs.decodeExitSync` result) and only care about the error side.
 *
 * **Details**
 *
 * - Applies {@link causeToClientError} to the failure cause.
 *
 * **Example** (Reading the error of an exit)
 *
 * ```ts
 * import { Exit, Option, Schema } from 'effect';
 * import { exitToClientError } from '@effect-trpc/core';
 *
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const exit: Exit.Exit<string, PostNotFound> = Exit.fail(new PostNotFound({ id: 9 }));
 * const error = exitToClientError(exit); // Option<ClientError<PostNotFound>>
 * if (Option.isSome(error)) console.log(error.value._tag); // "PostNotFound"
 * ```
 *
 * @see {@link causeToClientError}
 * @category errors
 * @since 0.1.0
 */
export const exitToClientError = <A, E>(
  exit: Exit.Exit<A, E | RpcClientError.RpcClientError>,
): Option.Option<ClientError<Exclude<E, RpcClientError.RpcClientError>>> =>
  Exit.isFailure(exit) ? Option.some(causeToClientError<E>(exit.cause)) : Option.none();
