import { Effect, Schema } from 'effect';
import { query, Router, type ClientError } from '@effect-trpc/core';
import { createCaller, Handlers } from '@effect-trpc/server';

// #region handlers
class RateLimited extends Schema.TaggedError<RateLimited>()('RateLimited', {
  retryAfterSeconds: Schema.Number,
}) {}

const router = Router.make({
  report: query({ payload: { id: Schema.String }, success: Schema.String, error: RateLimited }),
});

declare const loadReport: (id: string) => Promise<string>; // rejects with { status } on HTTP errors

const isRateLimit = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'status' in error && error.status === 429;

const HandlersLive = Handlers.make(router, {
  report: ({ id }) =>
    Effect.tryPromise(() => loadReport(id)).pipe(
      // A failure clients should handle: declare it and map to it.
      Effect.catchIf(
        (error) => isRateLimit(error.cause),
        () => Effect.fail(new RateLimited({ retryAfterSeconds: 30 })),
      ),
      // Everything else is a bug: log it with its cause, then make it a defect.
      Effect.catchTag('UnknownError', (error) =>
        Effect.logError('report failed', error.cause).pipe(Effect.andThen(Effect.die(error))),
      ),
    ),
});
// #endregion handlers

// #region client
const caller = createCaller(router, { handlers: HandlersLive });

try {
  await caller.$promise.report({ id: 'q3' });
} catch (cause) {
  const error = cause as ClientError<RateLimited>;
  switch (error._tag) {
    case 'RateLimited':
      break; // show "try again in 30s"
    case '@effect-trpc/RpcDefect':
      break; // show a generic error; the details are in the server logs
    case '@effect-trpc/RpcTransportError':
    case '@effect-trpc/RpcInterrupted':
      break;
  }
}
// #endregion client
