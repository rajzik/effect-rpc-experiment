// The harness takes a router service class: the client and caller decode class instances and
// typed errors.
import { Effect, Stream } from 'effect';
import { Router } from '@effect-trpc/core';
import { describe, expect, it } from 'vite-plus/test';
import { testCaller, testServerAndClient, testWebHandler, withTestServer } from '../src/index.js';
import { AppHandlers, AppRouter, Post, PostNotFound, postCreatedAt } from './service-fixtures.js';

const rejection = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );

describe('test-utils with a router service', () => {
  it('testServerAndClient: client, effectClient and caller', async () => {
    await using ctx = await testServerAndClient(AppRouter, { handlers: AppHandlers });
    expect(ctx.client.$router).toBe(Router.from(AppRouter));
    const post = await ctx.client.post.byId({ id: 1 });
    expect(post).toBeInstanceOf(Post);
    expect(post.headline()).toBe('#1 Hello');
    expect(post.createdAt).toEqual(postCreatedAt);
    expect(await rejection(ctx.client.post.byId({ id: 7 }))).toBeInstanceOf(PostNotFound);
    const missing = await Effect.runPromise(Effect.flip(ctx.effectClient.post.byId({ id: 7 })));
    expect(missing).toBeInstanceOf(PostNotFound);
    expect(await Effect.runPromise(Stream.runCollect(ctx.effectClient.post.titles()))).toEqual([
      'first',
      'second',
    ]);
    expect(await ctx.caller.$promise.post.byId({ id: 1 })).toBeInstanceOf(Post);
  });

  it('withTestServer, testWebHandler and testCaller', async () => {
    const title = await withTestServer(AppRouter, { handlers: AppHandlers }, async ({ client }) =>
      (await client.post.byId({ id: 1 })).headline(),
    );
    expect(title).toBe('#1 Hello');

    await using web = await testWebHandler(AppRouter, { handlers: AppHandlers });
    expect(await web.client.post.byId({ id: 1 })).toBeInstanceOf(Post);
    expect(await rejection(web.client.post.byId({ id: 7 }))).toBeInstanceOf(PostNotFound);

    await using caller = testCaller(AppRouter, AppHandlers);
    expect(await caller.$promise.post.byId({ id: 1 })).toBeInstanceOf(Post);
    expect(await Effect.runPromise(Effect.flip(caller.post.byId({ id: 7 })))).toBeInstanceOf(
      PostNotFound,
    );
  });
});
