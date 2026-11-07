import { Cause, Context, Effect, Option, Schema } from 'effect';
import { HttpContext, Procedure, Router } from '@effect-trpc/core';
import { Handlers, toWebHandler } from '@effect-trpc/server';
import type { OnErrorInfo } from '@effect-trpc/server';

// #region request
// `None` when the call did not arrive over HTTP (`createCaller`, `localLink`, tests).
const userAgent = Procedure.output(Schema.String).query(() =>
  Effect.map(
    HttpContext.request,
    Option.match({
      onNone: () => 'unknown',
      onSome: (request) => request.headers['user-agent'] ?? 'unknown',
    }),
  ),
);
// #endregion request

// #region login
// Set before the handler returns: the response is written once the `Exit` exists.
const login = Procedure.input({ token: Schema.String }).mutation(({ token }) =>
  Effect.gen(function* () {
    yield* HttpContext.setCookie('session', token, { httpOnly: true, secure: true, path: '/' });
    yield* HttpContext.setHeader('cache-control', 'no-store');
  }),
);
// #endregion login

// #region context
class RequestId extends Context.Service<RequestId, string>()('RequestId') {}

const appRouter = Router.make({
  userAgent,
  login,
  // Reads a service no middleware provides: it stays a requirement of the handlers layer.
  requestId: Procedure.output(Schema.String).query(() => RequestId),
});

// Evaluated once per call, before every middleware and the handler.
const context = Effect.map(HttpContext.request, (request) =>
  Context.make(
    RequestId,
    Option.match(request, {
      onNone: () => 'local',
      onSome: (req) => req.headers['x-request-id'] ?? crypto.randomUUID(),
    }),
  ),
);

// `RequestId` is a requirement of `fromProcedures`; `withContext` provides it per call.
const HandlersLive = Handlers.withContext(Handlers.fromProcedures(appRouter), context);
const web = await toWebHandler(appRouter, { handlers: HandlersLive });
// #endregion context

// #region onError
const onError = ({ path, cause, headers }: OnErrorInfo) =>
  Effect.logError(
    `${path} failed (request ${headers['x-request-id'] ?? '-'})`,
    Cause.pretty(cause),
  );

const reported = await toWebHandler(appRouter, { handlers: HandlersLive, onError });
// #endregion onError

void [web, reported];
