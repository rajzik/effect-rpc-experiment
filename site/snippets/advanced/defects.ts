import { Cause, Effect, Schema } from 'effect';
import { query, Router, RpcDefect } from '@rpc-effect/core';
import { createCaller, Handlers } from '@rpc-effect/server';

// #region handlers
class RateLimited extends Schema.TaggedError<RateLimited>()('RateLimited', {
  retryAfterSeconds: Schema.Finite,
}) {}

const router = Router.make({
  report: query({ payload: { id: Schema.String }, success: Schema.String, error: RateLimited }),
});

declare const loadReport: (id: string) => Promise<string>; // rejects with { status } on HTTP errors

const isRateLimit = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'status' in error && error.status === 429;

const HandlersLive = Handlers.make(router, {
  report: ({ id }) =>
    Effect.tryPromise({
      try: () => loadReport(id),
      // A failure clients should handle: declare it and map to it. Anything else is a bug.
      catch: (cause) =>
        isRateLimit(cause)
          ? new RateLimited({ retryAfterSeconds: 30 })
          : new Cause.UnknownError(cause),
    }).pipe(
      // Log the bug with its cause, then make it a defect.
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
  // cause: ClientError<RateLimited>
  if (cause instanceof RateLimited) {
    console.log(`try again in ${cause.retryAfterSeconds}s`);
  } else if (cause instanceof RpcDefect) {
    console.log('something went wrong'); // the details are in the server logs
  } // RpcTransportError / RpcInterrupted: retry or ignore
}
// #endregion client
