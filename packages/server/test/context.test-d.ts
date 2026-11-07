// Types of `Handlers.withContext`: handlers may require its services, the adapters do not.
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
declare const maybeContext: typeof context | undefined;
describe('withContext types', () => {
  it('the handlers layer requires the context service', () => {
    expectTypeOf(HandlersNeedingRequestId).toEqualTypeOf<
      Layer.Layer<Rpc.Handler<'echo'>, never, RequestId>
    >();
    expectTypeOf(context).toEqualTypeOf<Effect.Effect<Context.Context<RequestId>>>();
  });

  it('removes the context services from the requirements of the handlers', () => {
    expectTypeOf(Handlers.withContext(HandlersNeedingRequestId, context)).toEqualTypeOf<
      Layer.Layer<Rpc.Handler<'echo'>>
    >();
    // What `context` needs and `handlers` does not provide stays a requirement.
    expectTypeOf(Handlers.withContext(HandlersNeedingRequestId, contextNeedingClock)).toEqualTypeOf<
      Layer.Layer<Rpc.Handler<'echo'>, never, Clock2>
    >();
    expectTypeOf(
      Handlers.withContext(
        HandlersNeedingRequestId.pipe(Layer.provideMerge(ClockLive)),
        contextNeedingClock,
      ),
    ).toEqualTypeOf<Layer.Layer<Rpc.Handler<'echo'> | Clock2>>();
  });

  it('requires a context', () => {
    expectTypeOf<Parameters<typeof Handlers.withContext>['length']>().toEqualTypeOf<2>();
    // @ts-expect-error - the context is required
    void Handlers.withContext(HandlersNeedingRequestId);
    // @ts-expect-error - a possibly undefined context is rejected
    void Handlers.withContext(HandlersNeedingRequestId, maybeContext);
    const failing: Effect.Effect<Context.Context<RequestId>, string> = Effect.fail('nope');
    // @ts-expect-error - `context` cannot fail with a typed error (use middleware)
    void Handlers.withContext(HandlersNeedingRequestId, failing);
  });

  it('toWebHandler: handlers with a context are complete', () => {
    expectTypeOf(
      toWebHandler(router, { handlers: Handlers.withContext(HandlersNeedingRequestId, context) }),
    ).toEqualTypeOf<Promise<WebHandler>>();
    // @ts-expect-error - without `withContext`, RequestId is an unmet requirement of the handlers
    void toWebHandler(router, { handlers: HandlersNeedingRequestId });
    void toWebHandler(router, {
      // @ts-expect-error - Clock2 is not in the handlers layer output
      handlers: Handlers.withContext(HandlersNeedingRequestId, contextNeedingClock),
    });
  });

  it('toWebHandler with a router service: handlers with a context are complete', () => {
    class Svc extends Context.Service<Svc>()('Svc', {
      make: Effect.succeed({ echo: Procedure.output(Schema.String).query(() => RequestId) }),
    }) {}
    const handlers = Handlers.fromService(Svc);
    expectTypeOf(handlers).toEqualTypeOf<
      Layer.Layer<Rpc.Handler<'echo'> | Svc, never, RequestId>
    >();
    expectTypeOf(
      toWebHandler(Svc, { handlers: Handlers.withContext(handlers, context) }),
    ).toEqualTypeOf<Promise<WebHandler>>();
    // @ts-expect-error - without `withContext`, RequestId is an unmet requirement of the handlers
    void toWebHandler(Svc, { handlers });
  });

  it('layerHttp: context services are not requirements of the layer', () => {
    expectTypeOf(
      layerHttp(router, { handlers: Handlers.withContext(HandlersNeedingRequestId, context) }),
    ).toEqualTypeOf<Layer.Layer<never, never, HttpRouter.HttpRouter>>();
    expectTypeOf(layerHttp(router, { handlers: HandlersNeedingRequestId })).toEqualTypeOf<
      Layer.Layer<never, never, HttpRouter.HttpRouter | RequestId>
    >();
    expectTypeOf(
      layerHttp(router, {
        handlers: Handlers.withContext(HandlersNeedingRequestId, contextNeedingClock),
      }),
    ).toEqualTypeOf<Layer.Layer<never, never, HttpRouter.HttpRouter | Clock2>>();
  });

  it('serve / runServer: context services are not requirements', () => {
    const handlers = Handlers.withContext(HandlersNeedingRequestId, context);
    expectTypeOf(serve(router, { handlers, port: 0 })).toEqualTypeOf<
      Layer.Layer<never, HttpServerError.ServeError>
    >();
    expectTypeOf(serve(router, { handlers: HandlersNeedingRequestId, port: 0 })).toEqualTypeOf<
      Layer.Layer<never, HttpServerError.ServeError, RequestId>
    >();
    expectTypeOf(runServer(router, { handlers, port: 0 })).toEqualTypeOf<Promise<RunningServer>>();
    // @ts-expect-error - without `withContext`, RequestId is an unmet requirement of the handlers
    void runServer(router, { handlers: HandlersNeedingRequestId, port: 0 });
  });
});
