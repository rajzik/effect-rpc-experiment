// `onError`: the server hook called for every failed call (tRPC's `onError` adapter option).
import { Cause, Effect, Exit, Layer } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { RpcClient, RpcSerialization } from 'effect/rpc';
import { Socket } from 'effect/socket';
import { NodeHttpServer } from '@effect/platform-node';
import { Procedure, Router } from '@rpc-effect/core';
import { describe, expect, it } from 'vite-plus/test';
import { Handlers, layerHttp, toWebHandler } from '../src/index.js';
import type { OnErrorInfo } from '../src/index.js';
import { runServer } from '../src/node.js';
import { appRouter, makeServer, NotFound, Unauthorized } from './fixtures.js';
import { call, exitFrame, readFrames, rpcRequest } from './wire.js';

const recorder = () => {
  const calls: Array<OnErrorInfo> = [];
  const onError = (info: OnErrorInfo) => Effect.sync(() => calls.push(info));
  return { calls, onError };
};

const middlewares = () => [...appRouter.group.requests.values()].map((rpc) => [...rpc.middlewares]);

const failures = (cause: Cause.Cause<unknown>): ReadonlyArray<unknown> =>
  cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error);

describe('onError over toWebHandler', () => {
  it('is called once for a typed failure, with path, cause and request headers', async () => {
    const { calls, onError } = recorder();
    await using web = await toWebHandler(appRouter, { handlers: makeServer().layer, onError });
    const frames = await call(
      web,
      { tag: 'user.byId', payload: { id: 'ghost' } },
      { headers: { 'x-trace': 'abc' } },
    );
    expect(exitFrame(frames)).toEqual({
      _tag: 'Failure',
      cause: [{ _tag: 'Fail', error: { _tag: 'NotFound', id: 'ghost' } }],
    });
    expect(calls).toHaveLength(1);
    const [info] = calls;
    expect(info?.path).toBe('user.byId');
    expect(failures(info?.cause ?? Cause.empty)).toEqual([new NotFound({ id: 'ghost' })]);
    expect(info?.headers['x-trace']).toBe('abc');
  });

  it('is called for a defect', async () => {
    const { calls, onError } = recorder();
    await using web = await toWebHandler(appRouter, { handlers: makeServer().layer, onError });
    const frames = await call(web, { tag: 'debug.die' });
    expect(exitFrame(frames)).toMatchObject({ _tag: 'Failure', cause: [{ _tag: 'Die' }] });
    expect(calls.map((info) => info.path)).toEqual(['debug.die']);
    expect(Cause.hasDies(calls[0]?.cause ?? Cause.empty)).toBe(true);
  });

  it('is called for a subscription failing mid-stream', async () => {
    const { calls, onError } = recorder();
    await using web = await toWebHandler(appRouter, { handlers: makeServer().layer, onError });
    const frames = await call(web, { tag: 'debug.failMidStream' });
    expect(frames.at(-1)).toMatchObject({ _tag: 'Exit', exit: { _tag: 'Failure' } });
    expect(calls.map((info) => info.path)).toEqual(['debug.failMidStream']);
    expect(failures(calls[0]?.cause ?? Cause.empty)).toEqual([new NotFound({ id: 'stream' })]);
  });

  it('is not called for a success', async () => {
    const { calls, onError } = recorder();
    await using web = await toWebHandler(appRouter, { handlers: makeServer().layer, onError });
    const frames = await call(web, { tag: 'user.byId', payload: { id: 'ada' } });
    expect(exitFrame(frames)).toMatchObject({ _tag: 'Success' });
    expect(calls).toEqual([]);
  });

  it('sees typed failures of user middleware, with the procedure path', async () => {
    const { calls, onError } = recorder();
    await using web = await toWebHandler(appRouter, { handlers: makeServer().layer, onError });
    const frames = await call(web, { tag: 'user.me' });
    expect(exitFrame(frames)).toEqual({
      _tag: 'Failure',
      cause: [{ _tag: 'Fail', error: { _tag: 'Unauthorized' } }],
    });
    expect(calls.map((info) => info.path)).toEqual(['user.me']);
    expect(failures(calls[0]?.cause ?? Cause.empty)).toEqual([new Unauthorized()]);
  });

  it('is awaited before the failure is sent', async () => {
    const calls: Array<string> = [];
    const onError = (info: OnErrorInfo) =>
      Effect.sleep('20 millis').pipe(Effect.andThen(Effect.sync(() => calls.push(info.path))));
    await using web = await toWebHandler(appRouter, { handlers: makeServer().layer, onError });
    await call(web, { tag: 'user.byId', payload: { id: 'ghost' } });
    expect(calls).toEqual(['user.byId']);
  });

  it('a dying or throwing onError does not change the response', async () => {
    for (const onError of [
      () => Effect.die(new Error('onError died')),
      (): Effect.Effect<void> => {
        throw new Error('onError threw');
      },
    ]) {
      await using web = await toWebHandler(appRouter, { handlers: makeServer().layer, onError });
      const frames = await call(web, { tag: 'user.byId', payload: { id: 'ghost' } });
      expect(exitFrame(frames)).toEqual({
        _tag: 'Failure',
        cause: [{ _tag: 'Fail', error: { _tag: 'NotFound', id: 'ghost' } }],
      });
    }
  });

  it('is not called for calls rejected outside handler and middleware (client gets a Die)', async () => {
    const { calls, onError } = recorder();
    await using web = await toWebHandler(appRouter, { handlers: makeServer().layer, onError });
    const die = { _tag: 'Failure', cause: [{ _tag: 'Die' }] };
    // A payload that fails to decode, an unknown procedure, a success that fails to encode.
    expect(exitFrame(await call(web, { tag: 'user.byId', payload: { id: 1 } }))).toMatchObject(die);
    expect(exitFrame(await call(web, { tag: 'user.nope' }))).toMatchObject(die);
    expect(exitFrame(await call(web, { tag: 'debug.badOutput' }))).toMatchObject(die);
    expect(calls).toEqual([]);
  });

  it('is not called for an interrupt-only cause', async () => {
    const router = Router.make({ stop: Procedure.mutation(() => Effect.interrupt) });
    const { calls, onError } = recorder();
    await using web = await toWebHandler(router, {
      handlers: Handlers.fromProcedures(router),
      onError,
    });
    const frames = await call(web, { tag: 'stop' });
    expect(exitFrame(frames)).toMatchObject({ _tag: 'Failure', cause: [{ _tag: 'Interrupt' }] });
    expect(calls).toEqual([]);
  });

  it('without onError the router group is served unchanged', async () => {
    const before = middlewares();
    const { onError } = recorder();
    await using hooked = await toWebHandler(appRouter, { handlers: makeServer().layer, onError });
    await using plain = await toWebHandler(appRouter, { handlers: makeServer().layer });
    expect(middlewares()).toEqual(before);
    expect(exitFrame(await call(plain, { tag: 'health' }))).toEqual({
      _tag: 'Success',
      value: 'ok',
    });
    expect(exitFrame(await call(hooked, { tag: 'health' }))).toEqual({
      _tag: 'Success',
      value: 'ok',
    });
  });
});

describe('onError over runServer', () => {
  it('is passed through by the node adapter', async () => {
    const { calls, onError } = recorder();
    await using server = await runServer(appRouter, {
      handlers: makeServer().layer,
      port: 0,
      onError,
    });
    const response = await fetch(
      rpcRequest([{ tag: 'user.byId', payload: { id: 'ghost' } }], { url: server.url }),
    );
    expect(exitFrame(await readFrames(response))).toMatchObject({ _tag: 'Failure' });
    expect(calls.map((info) => info.path)).toEqual(['user.byId']);
  });
});

describe('onError over WebSocket', () => {
  it('a failing call reaches onError with its path', async () => {
    const { calls, onError } = recorder();
    const ServerLive = HttpRouter.serve(
      layerHttp(appRouter, { handlers: makeServer().layer, protocol: 'websocket', onError }),
      { disableLogger: true, disableListenLog: true },
    ).pipe(Layer.provideMerge(NodeHttpServer.layerTest));
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
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const client = yield* RpcClient.make(appRouter.group);
        return yield* client['user.byId']({ id: 'ghost' });
      }).pipe(Effect.scoped, Effect.provide(ClientLive)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(calls.map((info) => info.path)).toEqual(['user.byId']);
    expect(failures(calls[0]?.cause ?? Cause.empty)).toEqual([new NotFound({ id: 'ghost' })]);
  });
});
