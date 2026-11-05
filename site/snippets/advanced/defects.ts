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

declare const loadReport: (id: string) => Promise<string>;

const HandlersLive = Handlers.make(router, {
  report: ({ id }) =>
    Effect.tryPromise({
      try: () => loadReport(id),
      // A failure clients should handle: declare it, map to it.
      catch: () => new RateLimited({ retryAfterSeconds: 30 }),
    }).pipe(
      // Everything else is a bug: log it with the cause, let it become a defect.
      Effect.tapCause((cause) => Effect.logError('report failed', cause)),
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
