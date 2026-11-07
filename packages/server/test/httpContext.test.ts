import { Effect, Exit, Layer, Option, Schema, Stream } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { RpcClient, RpcSerialization } from 'effect/rpc';
import { Socket } from 'effect/socket';
import { NodeHttpServer } from '@effect/platform-node';
import { HttpContext, Procedure, Router } from '@effect-trpc/core';
import { describe, expect, it } from 'vite-plus/test';
import { createCaller, Handlers, layerHttp, toWebHandler } from '../src/index.js';
import { call, exitFrame, readFrames, rpcRequest } from './wire.js';

// `late` waits on the gate between its two elements; open by default.
const gate = { promise: Promise.resolve(), open: () => {} };
const closeGate = () => {
  gate.promise = new Promise((resolve) => {
    gate.open = resolve;
  });
};

const router = Router.make({
  whoami: Procedure.output(Schema.String).query(() =>
    Effect.map(
      HttpContext.request,
      Option.match({
        onNone: () => 'none',
        onSome: (req) => `${req.method} ${new URL(req.url, 'http://x').pathname}`,
      }),
    ),
  ),
  login: Procedure.mutation(() =>
    Effect.gen(function* () {
      yield* HttpContext.setHeader('x-a', '1');
      yield* HttpContext.appendHeader('x-b', '1');
      yield* HttpContext.appendHeader('x-b', '2');
      yield* HttpContext.setCookie('session', 'abc', { httpOnly: true, path: '/' });
    }),
  ),
  replace: Procedure.mutation(() =>
    Effect.gen(function* () {
      yield* HttpContext.setHeader('x-c', '1');
      yield* HttpContext.setHeader('x-c', '2');
      yield* HttpContext.setHeader('x-d', '1');
      yield* HttpContext.appendHeader('x-d', '2');
    }),
  ),
  badCookie: Procedure.mutation(() => HttpContext.setCookie('bad name', 'x')),
  badHeader: Procedure.mutation(() => HttpContext.setHeader('x-bad', 'a\r\nb')),
  early: Procedure.output(Schema.Finite).subscription(() =>
    Stream.fromEffect(HttpContext.setHeader('x-early', '1').pipe(Effect.as(1))),
  ),
  late: Procedure.output(Schema.Finite).subscription(() =>
    Stream.make(1).pipe(
      Stream.concat(
        Stream.fromEffect(
          Effect.promise(() => gate.promise).pipe(
            Effect.andThen(HttpContext.setHeader('x-late', '1')),
            Effect.as(2),
          ),
        ),
      ),
    ),
  ),
  socket: Procedure.output(Schema.String).mutation(() =>
    HttpContext.setHeader('x-ws', '1').pipe(
      Effect.andThen(HttpContext.request),
      Effect.map(
        Option.match({ onNone: () => 'none', onSome: (req) => req.headers.upgrade ?? 'plain' }),
      ),
    ),
  ),
});

const handlers = Handlers.fromProcedures(router);

const chunksOf = (
  frames: ReadonlyArray<{ readonly _tag: string; readonly values?: ReadonlyArray<unknown> }>,
) => frames.filter((f) => f._tag === 'Chunk').flatMap((f) => f.values ?? []);

describe('HttpContext over toWebHandler', () => {
  it('reads the request', async () => {
    await using web = await toWebHandler(router, { handlers });
    const frames = await call(web, { tag: 'whoami' });
    expect(exitFrame(frames)).toEqual({ _tag: 'Success', value: 'POST /rpc' });
  });

  it('sets headers and cookies', async () => {
    await using web = await toWebHandler(router, { handlers });
    const response = await web.handler(rpcRequest([{ tag: 'login' }]));
    expect(response.headers.get('x-a')).toBe('1');
    expect(response.headers.get('x-b')).toBe('1, 2');
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain('session=abc');
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[0]).toContain('Path=/');
    expect(exitFrame(await readFrames(response))).toMatchObject({ _tag: 'Success' });
  });

  it('setHeader replaces an earlier value, appendHeader appends to it', async () => {
    await using web = await toWebHandler(router, { handlers });
    const response = await web.handler(rpcRequest([{ tag: 'replace' }]));
    expect(response.headers.get('x-c')).toBe('2');
    expect(response.headers.get('x-d')).toBe('1, 2');
    expect(exitFrame(await readFrames(response))).toMatchObject({ _tag: 'Success' });
  });

  it('an invalid cookie is a defect of the call', async () => {
    await using web = await toWebHandler(router, { handlers });
    const frames = await call(web, { tag: 'badCookie' });
    expect(exitFrame(frames)).toMatchObject({ _tag: 'Failure', cause: [{ _tag: 'Die' }] });
  });

  it('an invalid header is a defect of the call, not a broken response', async () => {
    await using web = await toWebHandler(router, { handlers });
    const frames = await call(web, { tag: 'badHeader' });
    expect(exitFrame(frames)).toMatchObject({ _tag: 'Failure', cause: [{ _tag: 'Die' }] });
  });

  it('subscription header before the first element is sent', async () => {
    await using web = await toWebHandler(router, { handlers });
    const response = await web.handler(rpcRequest([{ tag: 'early' }]));
    expect(response.headers.get('x-early')).toBe('1');
    expect(chunksOf(await readFrames(response))).toEqual([1]);
  });

  it('subscription header after first element is ignored', async () => {
    await using web = await toWebHandler(router, { handlers });
    closeGate();
    // The response (and its headers) exists once the first element is written.
    const response = await web.handler(rpcRequest([{ tag: 'late' }]));
    gate.open();
    const frames = await readFrames(response);
    // Element 2 is emitted after the late setHeader ran.
    expect(chunksOf(frames)).toEqual([1, 2]);
    expect(frames.at(-1)).toMatchObject({ _tag: 'Exit', exit: { _tag: 'Success' } });
    expect(response.headers.get('x-late')).toBeNull();
  });

  it('with json serialization a late subscription header is sent', async () => {
    await using web = await toWebHandler(router, { handlers, serialization: 'json' });
    const response = await web.handler(rpcRequest([{ tag: 'late' }], { format: 'json' }));
    expect(response.headers.get('x-late')).toBe('1');
    expect(chunksOf(await readFrames(response))).toEqual([1, 2]);
  });
});

describe('HttpContext over WebSocket', () => {
  it('the request is the upgrade request and setters still succeed', async () => {
    const ServerLive = HttpRouter.serve(layerHttp(router, { handlers, protocol: 'websocket' }), {
      disableLogger: true,
      disableListenLog: true,
    }).pipe(Layer.provideMerge(NodeHttpServer.layerTest));
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
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* RpcClient.make(router.group);
        return [yield* client.socket(), yield* client.socket()];
      }).pipe(Effect.scoped, Effect.provide(ClientLive)),
    );
    expect(results).toEqual(['websocket', 'websocket']);
  });
});

describe('HttpContext without HTTP', () => {
  it('caller has no request', async () => {
    await using caller = createCaller(router, { handlers });
    expect(await caller.$promise.whoami()).toBe('none');
    expect(await caller.$promise.login()).toBeUndefined();
  });

  it('caller still dies on an invalid cookie', async () => {
    await using caller = createCaller(router, { handlers });
    const exit = await Effect.runPromiseExit(caller.badCookie());
    expect(Exit.hasDies(exit)).toBe(true);
  });
});
