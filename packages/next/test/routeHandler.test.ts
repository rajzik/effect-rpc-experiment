// Route handler adapter (tRPC `tests/server/adapters/next.test.ts` + `next-app-dir.test.ts`):
// `export const { GET, POST } = createRouteHandler(...)` in `app/api/rpc/[[...rpc]]/route.ts`.
import { createClient, httpLink } from '@effect-trpc/client';
import { Codecs, Router } from '@effect-trpc/core';
import { Effect, Exit, Layer } from 'effect';
import { describe, expect, test } from 'vite-plus/test';
import { createRouteHandler } from '../src/index.js';
import { appRouter, makeFixture, Post, PostNotFound } from './fixtures.js';

interface Frame {
  readonly _tag: string;
  readonly values?: ReadonlyArray<unknown>;
  readonly exit?: unknown;
}

/** A raw effect/rpc request, as `httpLink` sends it (NDJSON). */
const rpcRequest = (
  url: string,
  tag: string,
  payload: unknown,
  init: { readonly method?: string } = {},
): Request =>
  new Request(url, {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/ndjson' },
    body: `${JSON.stringify({ _tag: 'Request', id: '1', tag, payload, headers: [] })}\n`,
  });

const readFrames = async (response: Response): Promise<ReadonlyArray<Frame>> =>
  (await response.text())
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Frame);

const exitOf = (frames: ReadonlyArray<Frame>): unknown =>
  frames.find((frame) => frame._tag === 'Exit')?.exit;

describe('createRouteHandler', () => {
  test('POST answers a raw rpc request with the encoded Exit', async () => {
    const { handlers } = makeFixture();
    await using route = createRouteHandler(appRouter, { handlers });
    const response = await route.POST(
      rpcRequest('http://localhost/api/rpc', 'post.byId', { id: 1 }),
    );
    expect(response.status).toBe(200);
    const exit = exitOf(await readFrames(response));
    expect(exit).toEqual({
      _tag: 'Success',
      value: { id: 1, title: 'Hello world', createdAt: '2026-01-02T03:04:05.000Z' },
    });
    // the same JSON decodes back to a real `Post`
    const decoded = Codecs.decodeExitSync(Router.getRpc(appRouter, 'post.byId'), exit);
    expect(Exit.isSuccess(decoded) && decoded.value).toBeInstanceOf(Post);
  });

  test('typed failures are encoded into the Exit', async () => {
    const { handlers } = makeFixture();
    await using route = createRouteHandler(appRouter, { handlers });
    const response = await route.POST(
      rpcRequest('http://localhost/api/rpc', 'post.byId', { id: 404 }),
    );
    expect(response.status).toBe(200);
    const exit = exitOf(await readFrames(response));
    expect(exit).toEqual({
      _tag: 'Failure',
      cause: [{ _tag: 'Fail', error: { _tag: 'PostNotFound', id: 404 } }],
    });
    const decoded = Codecs.decodeExitSync(Router.getRpc(appRouter, 'post.byId'), exit);
    expect(Exit.isFailure(decoded)).toBe(true);
  });

  test('subscriptions stream NDJSON chunks', async () => {
    const { handlers } = makeFixture();
    await using route = createRouteHandler(appRouter, { handlers });
    const response = await route.POST(rpcRequest('http://localhost/api/rpc', 'ticks', { n: 3 }));
    expect(response.headers.get('content-type')).toContain('ndjson');
    const frames = await readFrames(response);
    const values = frames.filter((f) => f._tag === 'Chunk').flatMap((f) => f.values ?? []);
    expect(values).toEqual([0, 1, 2]);
    expect(exitOf(frames)).toMatchObject({ _tag: 'Success' });
  });

  test('a real client over httpLink receives class instances and typed errors', async () => {
    const { handlers } = makeFixture();
    await using route = createRouteHandler(appRouter, { handlers });
    await using client = createClient(appRouter, {
      link: httpLink({
        url: 'http://localhost:3000/api/rpc',
        fetch: (input, init) => route.POST(new Request(input, init)),
      }),
    });
    const post = await client.post.byId({ id: 1 });
    expect(post).toBeInstanceOf(Post);
    expect(post.shout()).toBe('HELLO WORLD!');
    expect(post.createdAt).toBeInstanceOf(Date);
    await expect(client.post.byId({ id: 404 })).rejects.toBeInstanceOf(PostNotFound);
  });

  test('catch-all segments, trailing slashes and basePath are rewritten to the endpoint', async () => {
    const { handlers } = makeFixture();
    await using route = createRouteHandler(appRouter, {
      handlers,
      path: '/api/rpc',
      basePath: '/docs',
    });
    for (const url of [
      'http://localhost/api/rpc/',
      'http://localhost/api/rpc/post.byId',
      'http://localhost/api/rpc/a/b/c?batch=1',
      'http://localhost/docs/api/rpc',
      'http://localhost/docs/api/rpc/anything',
    ]) {
      const response = await route.POST(rpcRequest(url, 'post.byId', { id: 2 }));
      expect({ url, status: response.status }).toEqual({ url, status: 200 });
      expect({ url, exit: exitOf(await readFrames(response)) }).toMatchObject({
        url,
        exit: { _tag: 'Success', value: { id: 2 } },
      });
    }
    const outside = await route.POST(rpcRequest('http://localhost/api/rpcx', 'post.byId', {}));
    expect(outside.status).toBe(404);
    expect(await outside.json()).toMatchObject({ _tag: 'NotFound' });
  });

  test('a custom path', async () => {
    const { handlers } = makeFixture();
    await using route = createRouteHandler(appRouter, { handlers, path: '/rpc' });
    const ok = await route.POST(rpcRequest('http://localhost/rpc/x', 'post.byId', { id: 1 }));
    expect(ok.status).toBe(200);
    const notFound = await route.POST(rpcRequest('http://localhost/api/rpc', 'post.byId', {}));
    expect(notFound.status).toBe(404);
  });

  test('GET answers 405 with Allow: POST', async () => {
    const { handlers, state } = makeFixture();
    await using route = createRouteHandler(appRouter, { handlers });
    const response = await route.GET(new Request('http://localhost/api/rpc?input=1'));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(await response.json()).toMatchObject({ _tag: 'MethodNotAllowed' });
    // GET does not build the server
    expect(state.builds.count).toBe(0);
  });

  test('builds the handler layer lazily, once, and dispose() releases it', async () => {
    const { handlers, state } = makeFixture();
    const route = createRouteHandler(appRouter, { handlers });
    expect(state.builds.count).toBe(0);
    const url = 'http://localhost/api/rpc';
    const responses = await Promise.all([
      route.POST(rpcRequest(url, 'post.byId', { id: 1 })),
      route.POST(rpcRequest(url, 'post.byId', { id: 2 })),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    await route.POST(rpcRequest(url, 'post.byId', { id: 3 }));
    expect(state.builds.count).toBe(1);
    await route.dispose();
    await route.dispose(); // idempotent
    expect(state.builds.released).toBe(1);
    const after = await route.POST(rpcRequest(url, 'post.byId', { id: 1 }));
    expect(after.status).toBe(503);
  });

  test('a handler layer that fails to build rejects the request; the next request retries', async () => {
    const { handlers } = makeFixture();
    let attempts = 0;
    // the first build fails, the second one succeeds
    const failingOnce = Layer.suspend(() =>
      attempts++ === 0
        ? (Layer.effectDiscard(
            Effect.die(new Error('database down')),
          ) as unknown as typeof handlers)
        : handlers,
    );
    await using route = createRouteHandler(appRouter, { handlers: failingOnce });
    const url = 'http://localhost/api/rpc';
    await expect(route.POST(rpcRequest(url, 'post.byId', { id: 1 }))).rejects.toThrow(
      /database down/,
    );
    const response = await route.POST(rpcRequest(url, 'post.byId', { id: 1 }));
    expect(response.status).toBe(200);
  });

  test('dispose() before any request does not build anything', async () => {
    const { handlers, state } = makeFixture();
    const route = createRouteHandler(appRouter, { handlers });
    await route.dispose();
    expect(state.builds).toEqual({ count: 0, released: 0 });
  });
});
