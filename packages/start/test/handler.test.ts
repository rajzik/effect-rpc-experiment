// `createStartHandler`: a TanStack Start server route handler (`server.handlers.POST`).
import { createClient, httpLink } from '@effect-trpc/client';
import { causeToClientError, Codecs, Router } from '@effect-trpc/core';
import { Effect, Exit, Layer } from 'effect';
import { afterEach, describe, expect, test } from 'vite-plus/test';
import { createStartHandler, type StartHandler } from '../src/index.js';
import {
  appRouter,
  createdAt,
  exitOf,
  Forbidden,
  makeFixture,
  Post,
  PostNotFound,
  readFrames,
  rpcRequest,
} from './fixtures.js';

const handlers: Array<StartHandler> = [];
const request = () => rpcRequest('http://x/api/rpc', 'post.byId', { id: 1 });
const make = (options: { readonly path?: string } = {}) => {
  const fixture = makeFixture();
  const handler = createStartHandler(appRouter, { handlers: fixture.handlers, ...options });
  handlers.push(handler);
  return { ...fixture, handler };
};

afterEach(async () => {
  await Promise.all(handlers.splice(0).map((handler) => handler.dispose()));
});

describe('createStartHandler', () => {
  test('answers { request } with an encoded success Exit (200)', async () => {
    const { handler } = make();
    const response = await handler({
      request: rpcRequest('http://x/api/rpc/$', 'post.byId', { id: 1 }),
    });
    expect(response.status).toBe(200);
    const exit = exitOf(await readFrames(response));
    expect(exit).toEqual({
      _tag: 'Success',
      value: { id: 1, title: 'Hello world', createdAt: createdAt.toISOString() },
    });
    const decoded = Codecs.decodeExitSync(Router.getRpc(appRouter, 'post.byId'), exit);
    expect(Exit.isSuccess(decoded) && decoded.value).toBeInstanceOf(Post);
  });

  test('encodes typed failures as a Fail cause that decodes to the TaggedError', async () => {
    const { handler } = make();
    const response = await handler({
      request: rpcRequest('http://x/api/rpc', 'post.byId', { id: 404 }),
    });
    expect(response.status).toBe(200);
    const exit = exitOf(await readFrames(response));
    expect(exit).toEqual({
      _tag: 'Failure',
      cause: [{ _tag: 'Fail', error: { _tag: 'PostNotFound', id: 404 } }],
    });
    const decoded = Codecs.decodeExitSync(Router.getRpc(appRouter, 'post.byId'), exit);
    expect(Exit.isFailure(decoded) && causeToClientError(decoded.cause)).toBeInstanceOf(
      PostNotFound,
    );
  });

  test('encodes defects as Die and keeps serving', async () => {
    const { handler } = make();
    const died = await handler({ request: rpcRequest('http://x/api/rpc', 'boom') });
    expect(exitOf(await readFrames(died))).toMatchObject({
      _tag: 'Failure',
      cause: [{ _tag: 'Die', defect: { message: 'kaboom' } }],
    });
    const next = await handler({ request: rpcRequest('http://x/api/rpc', 'post.byId', { id: 2 }) });
    expect(exitOf(await readFrames(next))).toMatchObject({ _tag: 'Success' });
  });

  test('streams subscriptions as NDJSON chunks before the Exit', async () => {
    const { handler } = make();
    const response = await handler({
      request: rpcRequest('http://x/api/rpc', 'feed', { count: 3 }),
    });
    expect(response.headers.get('content-type')).toContain('ndjson');
    const frames = await readFrames(response);
    const values = frames.filter((f) => f._tag === 'Chunk').flatMap((f) => f.values ?? []);
    expect(values).toHaveLength(3);
    const rpc = Router.getRpc(appRouter, 'feed');
    expect(values.map((v) => Codecs.decodeSuccessSync(rpc, v).shout())).toEqual([
      'POST 1!',
      'POST 2!',
      'POST 3!',
    ]);
    expect(frames.at(-1)).toMatchObject({ _tag: 'Exit', exit: { _tag: 'Success' } });
  });

  test('rewrites catch-all urls below the mount path and keeps the query string', async () => {
    const { handler } = make();
    const urls = [
      'http://x/api/rpc',
      'http://x/api/rpc/',
      'http://x/api/rpc/$',
      'http://x/api/rpc/post.byId',
      'http://x/api/rpc/a/b/c?batch=1',
    ];
    const results = await Promise.all(
      urls.map(async (url) => {
        const response = await handler({ request: rpcRequest(url, 'post.byId', { id: 3 }) });
        const exit = exitOf(await readFrames(response)) as { readonly _tag: string };
        return [url, response.status, exit._tag];
      }),
    );
    expect(results).toEqual(urls.map((url) => [url, 200, 'Success']));
    const outside = await handler({ request: rpcRequest('http://x/api/other', 'boom') });
    expect(outside.status).toBe(404);
    expect(await outside.json()).toMatchObject({ _tag: 'NotFound' });
    const prefixOnly = await handler({ request: rpcRequest('http://x/api/rpcx', 'boom') });
    expect(prefixOnly.status).toBe(404);
  });

  test('honours a custom (normalized) path', async () => {
    const { handler } = make({ path: 'trpc/' });
    const ok = await handler({ request: rpcRequest('http://x/trpc/$', 'post.byId', { id: 1 }) });
    expect(ok.status).toBe(200);
    const miss = await handler({ request: rpcRequest('http://x/api/rpc', 'post.byId', { id: 1 }) });
    expect(miss.status).toBe(404);
  });

  test('answers non-POST methods (GET key) with 405 JSON and Allow: POST', async () => {
    const { handler, state } = make();
    const response = await handler({ request: new Request('http://x/api/rpc/post.byId') });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(await response.json()).toMatchObject({ _tag: 'MethodNotAllowed' });
    // rejected before the handler layer is built
    expect(state.built).toBe(0);
  });

  test('builds the handler layer lazily, once, and dispose releases it (then 503)', async () => {
    const { handler, state } = make();
    expect(state.built).toBe(0);
    await Promise.all(
      [1, 2, 3].map((id) =>
        handler({ request: rpcRequest('http://x/api/rpc', 'post.byId', { id }) }),
      ),
    );
    expect(state.built).toBe(1);
    await handler.dispose();
    await handler.dispose(); // idempotent
    expect(state.released).toBe(1);
    const after = await handler({
      request: rpcRequest('http://x/api/rpc', 'post.byId', { id: 1 }),
    });
    expect(after.status).toBe(503);
  });

  test('dispose before the first request does not build anything', async () => {
    const { handler, state } = make();
    await handler.dispose();
    expect(state.built).toBe(0);
  });

  test('a failed layer build rejects the request and is retried on the next one', async () => {
    const fixture = makeFixture();
    let calls = 0;
    const layer = Layer.suspend(() => {
      calls++;
      return calls === 1
        ? fixture.handlers.pipe(
            Layer.provide(Layer.effectDiscard(Effect.die(new Error('db down')))),
          )
        : fixture.handlers;
    });
    const handler = createStartHandler(appRouter, { handlers: layer });
    handlers.push(handler);
    await expect(handler({ request: request() })).rejects.toBeDefined();
    const response = await handler({ request: request() });
    expect(exitOf(await readFrames(response))).toMatchObject({ _tag: 'Success' });
    expect(calls).toBe(2);
  });

  test('end to end: httpLink through the handler yields Post and PostNotFound instances', async () => {
    const { handler } = make();
    const client = createClient(appRouter, {
      link: httpLink({
        url: 'http://x/api/rpc',
        fetch: (input, init) => handler({ request: new Request(input, init) }),
      }),
    });
    try {
      const post = await client.post.byId({ id: 1 });
      expect(post).toBeInstanceOf(Post);
      expect(post.shout()).toBe('HELLO WORLD!');
      expect(post.createdAt).toEqual(createdAt);
      const error = await client.post.byId({ id: 404 }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PostNotFound);
      const forbidden = await client.post.create({ title: 'forbidden' }).catch((e: unknown) => e);
      expect(forbidden).toBeInstanceOf(Forbidden);
      const created = await client.post.create({ title: 'new' });
      expect(created).toBeInstanceOf(Post);
      const titles: Array<string> = [];
      for await (const p of client.feed({ count: 2 })) titles.push(p.title);
      expect(titles).toEqual(['Post 1', 'Post 2']);
    } finally {
      await client.dispose();
    }
  });
});
