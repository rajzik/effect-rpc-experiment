// `context`: the per-call request context of the HTTP adapters (tRPC's `createContext`).
import { Context, Effect, Layer, Option, Schema } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { RpcClient, RpcSerialization } from 'effect/rpc';
import { Socket } from 'effect/socket';
import { NodeHttpServer } from '@effect/platform-node';
import { HttpContext, Procedure, Router } from '@effect-trpc/core';
import { describe, expect, it } from 'vite-plus/test';
import { Handlers, layerHttp, Middleware, toWebHandler } from '../src/index.js';
import type { OnErrorInfo } from '../src/index.js';
import { runServer } from '../src/node.js';
import { call, exitFrame, readFrames, rpcRequest } from './wire.js';

class RequestId extends Context.Service<RequestId, string>()('RequestId') {}
class Clock2 extends Context.Service<Clock2, { readonly now: string }>()('Clock2') {}
class Seen extends Context.Service<Seen, string>()('Seen') {}

/** A user middleware reading the `context` service. */
class Tagger extends Middleware.make<Tagger, { provides: Seen; requires: RequestId }>()('Tagger') {}

const TaggerLive = Layer.succeed(Tagger)(
  Tagger.of((effect) =>
    Effect.gen(function* () {
      const id = yield* RequestId;
      return yield* Effect.provideService(effect, Seen, `mw:${id}`);
    }),
  ),
);

const router = Router.make({
  echo: Procedure.output(Schema.String).query(() => RequestId),
  tagged: Procedure.output(Schema.String)
    .middleware(Tagger)
    .query(() => Seen),
});

const handlers = Layer.mergeAll(Handlers.fromProcedures(router), TaggerLive);

const fromHeader = Effect.map(HttpContext.request, (request) =>
  Context.make(
    RequestId,
    Option.match(request, {
      onNone: () => 'none',
      onSome: (req) => req.headers['x-request-id'] ?? 'missing',
    }),
  ),
);

/** A `context` given only when `enabled`: typed `Effect | undefined`. */
const optional = (enabled: boolean) => (enabled ? fromHeader : undefined);

/** A `context` needing `Clock2`, which only a sibling of the handlers (`ClockLive`) provides. */
const stamped = Effect.map(Clock2, (clock) => Context.make(RequestId, clock.now));
const ClockLive = Layer.succeed(Clock2)({ now: 't-1' });

/** A `context` counting its evaluations. */
const counting = () => {
  let count = 0;
  return Effect.sync(() => Context.make(RequestId, String(++count)));
};

describe('context over toWebHandler', () => {
  it('provides its services to the handler, per request', async () => {
    await using web = await toWebHandler(router, { handlers, context: fromHeader });
    for (const id of ['r-1', 'r-2']) {
      const frames = await call(web, { tag: 'echo' }, { headers: { 'x-request-id': id } });
      expect(exitFrame(frames)).toEqual({ _tag: 'Success', value: id });
    }
  });

  it('runs once per call', async () => {
    await using web = await toWebHandler(router, { handlers, context: counting() });
    expect(exitFrame(await call(web, { tag: 'echo' }))).toEqual({ _tag: 'Success', value: '1' });
    expect(exitFrame(await call(web, { tag: 'echo' }))).toEqual({ _tag: 'Success', value: '2' });
  });

  it('wraps user middleware: middleware reads its services', async () => {
    await using web = await toWebHandler(router, { handlers, context: fromHeader });
    const frames = await call(web, { tag: 'tagged' }, { headers: { 'x-request-id': 'r-3' } });
    expect(exitFrame(frames)).toEqual({ _tag: 'Success', value: 'mw:r-3' });
  });

  it('reads services of the handlers layer output', async () => {
    await using web = await toWebHandler(router, {
      handlers: Layer.merge(handlers, ClockLive),
      context: stamped,
    });
    expect(exitFrame(await call(web, { tag: 'echo' }))).toEqual({ _tag: 'Success', value: 't-1' });
  });

  it('a context that is undefined at runtime leaves its services missing (Gotcha)', async () => {
    await using web = await toWebHandler(router, { handlers, context: optional(false) });
    const frames = await call(web, { tag: 'echo' });
    expect(exitFrame(frames)).toMatchObject({ _tag: 'Failure', cause: [{ _tag: 'Die' }] });
  });

  it('a dying context fails the call with a defect, reported to onError', async () => {
    const paths: Array<string> = [];
    const onError = (info: OnErrorInfo) => Effect.sync(() => paths.push(info.path));
    const dying: Effect.Effect<Context.Context<RequestId>> = Effect.die(new Error('no context'));
    await using web = await toWebHandler(router, { handlers, context: dying, onError });
    const frames = await call(web, { tag: 'echo' });
    expect(exitFrame(frames)).toMatchObject({ _tag: 'Failure', cause: [{ _tag: 'Die' }] });
    expect(paths).toEqual(['echo']);
  });
});

describe('context over runServer', () => {
  it('is passed through by the node adapter', async () => {
    await using server = await runServer(router, { handlers, context: fromHeader, port: 0 });
    const response = await fetch(
      rpcRequest([{ tag: 'echo' }], { url: server.url, headers: { 'x-request-id': 'n-1' } }),
    );
    expect(exitFrame(await readFrames(response))).toEqual({ _tag: 'Success', value: 'n-1' });
  });

  it('reads services of the handlers layer output', async () => {
    await using server = await runServer(router, {
      handlers: Layer.merge(handlers, ClockLive),
      context: stamped,
      port: 0,
    });
    const response = await fetch(rpcRequest([{ tag: 'echo' }], { url: server.url }));
    expect(exitFrame(await readFrames(response))).toEqual({ _tag: 'Success', value: 't-1' });
  });
});

/** Serves `app` (a WebSocket rpc route) and calls `echo`, then `tagged`, on one connection. */
const callOverWebSocket = (app: Layer.Layer<never, never, HttpRouter.HttpRouter>) => {
  const ServerLive = HttpRouter.serve(app, { disableLogger: true, disableListenLog: true }).pipe(
    Layer.provideMerge(NodeHttpServer.layerTest),
  );
  const ClientLive = Layer.unwrap(
    Effect.gen(function* () {
      const address = HttpServer.formatAddress((yield* HttpServer.HttpServer).address);
      return RpcClient.layerProtocolSocket().pipe(
        Layer.provide([
          Socket.layerWebSocket(`${address.replace(/^http/, 'ws')}/rpc`).pipe(
            Layer.provide(Socket.layerWebSocketConstructorGlobal),
          ),
          RpcSerialization.layerNdjson,
        ]),
      );
    }),
  ).pipe(Layer.provide(ServerLive));
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(router.group);
      return [yield* client.echo(), yield* client.tagged()];
    }).pipe(Effect.scoped, Effect.provide(ClientLive)),
  );
};

describe('context over WebSocket', () => {
  it('runs per call on one connection', async () => {
    const app = layerHttp(router, { handlers, protocol: 'websocket', context: counting() });
    expect(await callOverWebSocket(app)).toEqual(['1', 'mw:2']);
  });

  it('reads services of the handlers layer output', async () => {
    const app = layerHttp(router, {
      handlers: Layer.merge(handlers, ClockLive),
      protocol: 'websocket',
      context: stamped,
    });
    expect(await callOverWebSocket(app)).toEqual(['t-1', 'mw:t-1']);
  });
});
