import { Effect, Schema } from 'effect';
import { RpcSerialization } from 'effect/rpc';
import { Codecs, causeToClientError, query, Router } from '@effect-trpc/core';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { Handlers, toWebHandler } from '../src/index.js';
import type { WebHandler } from '../src/index.js';
import {
  appRouter,
  createdAt,
  getCause,
  getSuccess,
  makeServer,
  NotFound,
  User,
} from './fixtures.js';
import type { Probe } from './fixtures.js';
import { call, decodeUserByIdExit, exitFrame, readFrames, rpcRequest } from './wire.js';

let web: WebHandler;
let probe: Probe;

beforeEach(async () => {
  const server = makeServer();
  probe = server.probe;
  web = await toWebHandler(appRouter, { handlers: server.layer });
});

afterEach(async () => {
  await web.dispose();
});

describe('toWebHandler', () => {
  it('answers a query with an encoded success that decodes to class instances', async () => {
    const frames = await call(web, { tag: 'user.byId', payload: { id: 'ada' } });
    expect(exitFrame(frames)).toEqual({
      _tag: 'Success',
      value: { id: 'ada', name: 'Ada', createdAt: createdAt.toISOString() },
    });
    const user = getSuccess(decodeUserByIdExit(frames));
    expect(user).toBeInstanceOf(User);
    expect(user.greet()).toBe('Hello, Ada!');
    expect(user.createdAt).toEqual(createdAt);
  });

  it('encodes typed failures as Fail causes that decode to error instances', async () => {
    const frames = await call(web, { tag: 'user.byId', payload: { id: 'ghost' } });
    expect(exitFrame(frames)).toEqual({
      _tag: 'Failure',
      cause: [{ _tag: 'Fail', error: { _tag: 'NotFound', id: 'ghost' } }],
    });
    const error = causeToClientError(getCause(decodeUserByIdExit(frames)));
    expect(error).toBeInstanceOf(NotFound);
  });

  it('encodes defects as Die and keeps serving later requests', async () => {
    const died = await call(web, { tag: 'debug.die' });
    expect(exitFrame(died)).toEqual({
      _tag: 'Failure',
      cause: [{ _tag: 'Die', defect: { name: 'Error', message: 'boom' } }],
    });
    const next = await call(web, { tag: 'health' });
    expect(exitFrame(next)).toEqual({ _tag: 'Success', value: 'ok' });
  });

  it('streams subscription elements as NDJSON chunks before the exit', async () => {
    const response = await web.handler(rpcRequest([{ tag: 'user.list', payload: { count: 3 } }]));
    expect(response.headers.get('content-type')).toContain('ndjson');
    const frames = await readFrames(response);
    const chunks = frames.filter((f) => f._tag === 'Chunk').flatMap((f) => f.values ?? []);
    expect(chunks).toHaveLength(3);
    const rpc = Router.getRpc(appRouter, 'user.list');
    const users = chunks.map((value) => Codecs.decodeSuccessSync(rpc, value));
    expect(users.map((u) => u.greet())).toEqual([
      'Hello, User 1!',
      'Hello, User 2!',
      'Hello, User 3!',
    ]);
    expect(frames.at(-1)).toMatchObject({ _tag: 'Exit', exit: { _tag: 'Success' } });
  });

  it('answers an unknown procedure with a defect instead of crashing', async () => {
    const frames = await call(web, { tag: 'does.not.exist', payload: {} });
    expect(exitFrame(frames)).toEqual({
      _tag: 'Failure',
      cause: [{ _tag: 'Die', defect: 'Unknown request tag: does.not.exist' }],
    });
    expect(exitFrame(await call(web, { tag: 'health' }))).toMatchObject({ _tag: 'Success' });
  });

  it('handles several requests in one body', async () => {
    const response = await web.handler(
      rpcRequest([
        { tag: 'user.byId', payload: { id: 'ada' }, id: '1' },
        { tag: 'user.byId', payload: { id: 'nope' }, id: '2' },
        { tag: 'debug.ping', id: '3' },
      ]),
    );
    const frames = await readFrames(response);
    const byId = new Map(frames.map((f) => [f.requestId, f.exit]));
    expect(byId.get('1')).toMatchObject({ _tag: 'Success' });
    expect(byId.get('2')).toMatchObject({ _tag: 'Failure' });
    expect(byId.get('3')).toEqual({ _tag: 'Success', value: 'pong' });
  });

  it('passes HTTP request headers to middleware and handlers', async () => {
    const me = await call(web, { tag: 'user.me' }, { headers: { 'x-user': 'grace' } });
    expect(exitFrame(me)).toMatchObject({ _tag: 'Success', value: { name: 'grace' } });
    const traced = await call(web, { tag: 'debug.headers' }, { headers: { 'x-trace': 't-1' } });
    expect(exitFrame(traced)).toEqual({ _tag: 'Success', value: { trace: 't-1' } });
    const denied = await call(web, { tag: 'user.me' });
    expect(exitFrame(denied)).toEqual({
      _tag: 'Failure',
      cause: [{ _tag: 'Fail', error: { _tag: 'Unauthorized' } }],
    });
    expect(probe.events).toContain('auth:grace');
  });

  it('dispose() releases the handler layer', async () => {
    await call(web, { tag: 'health' });
    await web.dispose();
    await probe.released;
    // dispose is idempotent
    await web.dispose();
    expect(probe.events).toEqual([]);
  });

  it('dispose() interrupts in-flight requests and answers 503 afterwards', async () => {
    const pending = web.handler(rpcRequest([{ tag: 'debug.hang' }]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await web.dispose();
    const frames = await readFrames(await pending);
    const exit = exitFrame(frames) as { _tag: string; cause: ReadonlyArray<{ _tag: string }> };
    expect(exit._tag).toBe('Failure');
    expect(exit.cause.map((reason) => reason._tag)).toContain('Interrupt');
    expect(exit.cause.every((reason) => reason._tag === 'Interrupt')).toBe(true);
    await expect(probe.hangInterrupted).resolves.toBeUndefined();
    const after = await web.handler(rpcRequest([{ tag: 'health' }]));
    expect(after.status).toBe(503);
  });

  it('supports serialization: "json"', async () => {
    const { layer } = makeServer();
    const json = await toWebHandler(appRouter, { handlers: layer, serialization: 'json' });
    try {
      const response = await json.handler(
        rpcRequest([{ tag: 'user.byId', payload: { id: 'ada' } }], { format: 'json' }),
      );
      expect(response.headers.get('content-type')).toContain('application/json');
      const frames = await readFrames(response);
      expect(getSuccess(decodeUserByIdExit(frames))).toBeInstanceOf(User);
    } finally {
      await json.dispose();
    }
  });

  it('accepts a custom serialization layer and path', async () => {
    const { layer } = makeServer();
    const custom = await toWebHandler(appRouter, {
      handlers: layer,
      path: '/api/trpc',
      serialization: RpcSerialization.layerJson,
    });
    try {
      const ok = await custom.handler(
        rpcRequest([{ tag: 'health' }], { format: 'json', url: 'http://localhost/api/trpc' }),
      );
      expect(exitFrame(await readFrames(ok))).toEqual({ _tag: 'Success', value: 'ok' });
      const miss = await custom.handler(rpcRequest([{ tag: 'health' }], { format: 'json' }));
      expect(miss.status).toBe(404);
    } finally {
      await custom.dispose();
    }
  });

  it('rejects when the handler layer fails to build', async () => {
    class BootError extends Schema.TaggedError<BootError>()('BootError', {}) {}
    const router = Router.make({ ping: query({ success: Schema.String }) });
    const failing = Handlers.make(router, Effect.fail(new BootError()));
    await expect(toWebHandler(router, { handlers: failing })).rejects.toBeInstanceOf(BootError);
  });
});
