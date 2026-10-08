import { Cause, Exit, Option, Predicate, Schema } from 'effect';
import type { RpcClientError } from 'effect/rpc';

/**
 * The server died (an unexpected defect: `Effect.die`, a thrown exception, a schema decode
 * failure of the response, ...). `cause` holds the original defect.
 */
export class RpcDefect extends Schema.TaggedError<RpcDefect>()('@effect-trpc/RpcDefect', {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/**
 * The request could not be delivered or the response could not be read (network, HTTP status,
 * socket, protocol). `cause` holds the original `RpcClientError` from `effect/rpc`.
 */
export class RpcTransportError extends Schema.TaggedError<RpcTransportError>()(
  '@effect-trpc/RpcTransportError',
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/** The call was interrupted (aborted by the caller, or interrupted on the server). */
export class RpcInterrupted extends Schema.TaggedError<RpcInterrupted>()(
  '@effect-trpc/RpcInterrupted',
  {},
) {}

/** The infrastructure errors every client call may fail with, in addition to the procedure's `E`. */
export type ClientInfrastructureError = RpcDefect | RpcTransportError | RpcInterrupted;

/**
 * The error a client call rejects / fails with: the procedure's own typed error `E`, or one of
 * the infrastructure errors. Domain errors are never disguised as infrastructure errors and
 * vice versa.
 */
export type ClientError<E> = E | RpcDefect | RpcTransportError | RpcInterrupted;

const infrastructureTags: ReadonlySet<string> = new Set([
  '@effect-trpc/RpcDefect',
  '@effect-trpc/RpcTransportError',
  '@effect-trpc/RpcInterrupted',
]);

const RpcClientErrorTypeId = '~effect/rpc/RpcClientError';

/** Returns `true` for `RpcClientError` (the `effect/rpc` transport/protocol error). */
export const isRpcClientError = (u: unknown): u is RpcClientError.RpcClientError =>
  Predicate.hasProperty(u, RpcClientErrorTypeId);

/**
 * Returns `true` for `RpcDefect`, `RpcTransportError` and `RpcInterrupted`. Discriminates on
 * `_tag`, so it also recognizes errors that crossed a serialization boundary.
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
 * - `Fail(e)` where `e` is an `RpcClientError` → `RpcTransportError` (cause = the original error)
 * - `Fail(e)` otherwise → `e` itself (the same instance)
 * - `Die(defect)` → `RpcDefect` (message from `defect.message` or `String(defect)`)
 * - interruption only → `RpcInterrupted`
 *
 * Typed failures take precedence over defects, defects over interruption (like `Cause.squash`).
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
 * The {@link ClientError} of a failed exit, or `Option.none()` for a successful one.
 */
export const exitToClientError = <A, E>(
  exit: Exit.Exit<A, E | RpcClientError.RpcClientError>,
): Option.Option<ClientError<Exclude<E, RpcClientError.RpcClientError>>> =>
  Exit.isFailure(exit) ? Option.some(causeToClientError<E>(exit.cause)) : Option.none();
