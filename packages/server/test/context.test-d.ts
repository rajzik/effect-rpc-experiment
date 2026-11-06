// Types of the `context` option: handlers may require its services, the adapters do not.
import { Context, Effect, Layer, Option, Schema } from 'effect';
import type { HttpRouter, HttpServerError } from 'effect/http';
import type { Rpc } from 'effect/rpc';
import { HttpContext, Procedure, Router } from '@effect-trpc/core';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import { Handlers, layerHttp, toWebHandler } from '../src/index.js';
import type { WebHandler } from '../src/index.js';
import { runServer, serve } from '../src/node.js';
import type { RunningServer } from '../src/node.js';

class RequestId extends Context.Service<RequestId, string>()('RequestId') {}
class Clock2 extends Context.Service<Clock2, { readonly now: string }>()('Clock2') {}

const router = Router.make({ echo: Procedure.output(Schema.String).query(() => RequestId) });
const HandlersNeedingRequestId = Handlers.fromProcedures(router);
const ClockLive = Layer.succeed(Clock2)({ now: 'now' });

const context = Effect.map(HttpContext.request, (request) =>
  Context.make(
    RequestId,
    Option.match(request, {
      onNone: () => 'none',
      onSome: (req) => req.headers['x-request-id'] ?? 'missing',
    }),
  ),
);
const contextNeedingClock = Effect.map(Clock2, (clock) => Context.make(RequestId, clock.now));

describe('context option types', () => {
  it('the handlers layer requires the context service', () => {
    expectTypeOf(HandlersNeedingRequestId).toEqualTypeOf<
      Layer.Layer<Rpc.Handler<'echo'>, never, RequestId>
    >();
    expectTypeOf(context).toEqualTypeOf<Effect.Effect<Context.Context<RequestId>>>();
  });

  it('toWebHandler: handlers may require the context services', () => {
    expectTypeOf(
      toWebHandler(router, { handlers: HandlersNeedingRequestId, context }),
    ).toEqualTypeOf<Promise<WebHandler>>();
    // @ts-expect-error - without `context`, RequestId is an unmet requirement of the handlers
    void toWebHandler(router, { handlers: HandlersNeedingRequestId });
    const failing: Effect.Effect<Context.Context<RequestId>, string> = Effect.fail('nope');
    // @ts-expect-error - `context` cannot fail with a typed error (use middleware)
    void toWebHandler(router, { handlers: HandlersNeedingRequestId, context: failing });
  });

  it('toWebHandler: what `context` needs is provided by the handlers layer output', () => {
    const handlers = HandlersNeedingRequestId.pipe(Layer.provideMerge(ClockLive));
    expectTypeOf(toWebHandler(router, { handlers, context: contextNeedingClock })).toEqualTypeOf<
      Promise<WebHandler>
    >();
    // @ts-expect-error - Clock2 is not in the handlers layer output
    void toWebHandler(router, { handlers: HandlersNeedingRequestId, context: contextNeedingClock });
  });

  it('layerHttp: context services are not requirements of the layer', () => {
    expectTypeOf(layerHttp(router, { handlers: HandlersNeedingRequestId, context })).toEqualTypeOf<
      Layer.Layer<never, never, HttpRouter.HttpRouter>
    >();
    expectTypeOf(layerHttp(router, { handlers: HandlersNeedingRequestId })).toEqualTypeOf<
      Layer.Layer<never, never, HttpRouter.HttpRouter | RequestId>
    >();
    // What `context` needs and `handlers` does not provide stays a requirement.
    expectTypeOf(
      layerHttp(router, { handlers: HandlersNeedingRequestId, context: contextNeedingClock }),
    ).toEqualTypeOf<Layer.Layer<never, never, HttpRouter.HttpRouter | Clock2>>();
  });

  it('serve / runServer: context services are not requirements', () => {
    expectTypeOf(
      serve(router, { handlers: HandlersNeedingRequestId, context, port: 0 }),
    ).toEqualTypeOf<Layer.Layer<never, HttpServerError.ServeError>>();
    expectTypeOf(serve(router, { handlers: HandlersNeedingRequestId, port: 0 })).toEqualTypeOf<
      Layer.Layer<never, HttpServerError.ServeError, RequestId>
    >();
    expectTypeOf(
      runServer(router, { handlers: HandlersNeedingRequestId, context, port: 0 }),
    ).toEqualTypeOf<Promise<RunningServer>>();
    // @ts-expect-error - without `context`, RequestId is an unmet requirement of the handlers
    void runServer(router, { handlers: HandlersNeedingRequestId, port: 0 });
  });
});
