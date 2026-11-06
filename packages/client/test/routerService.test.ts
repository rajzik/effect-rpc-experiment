// `createClient` accepts a router service class directly: results are decoded to class instances
// and typed errors, over the Promise client and `$effect`.
import { Effect, Stream } from 'effect';
import { Router } from '@effect-trpc/core';
import { describe, expect, it } from 'vite-plus/test';
import { createClient, localLink } from '../src/index.js';
import { drain, rejectionOf } from './helpers.js';
import { AppHandlers, AppRouter, Post, PostNotFound, postCreatedAt } from './service-fixtures.js';

describe('createClient with a router service', () => {
  it('decodes class instances and typed errors over the Promise client', async () => {
    await using client = createClient(AppRouter, { link: localLink({ handlers: AppHandlers }) });
    const post = await client.post.byId({ id: 1 });
    expect(post).toBeInstanceOf(Post);
    expect(post.headline()).toBe('#1 Hello');
    expect(post.createdAt).toEqual(postCreatedAt);
    const missing = await rejectionOf(client.post.byId({ id: 7 }));
    expect(missing).toBeInstanceOf(PostNotFound);
    expect(missing).toMatchObject({ _tag: 'PostNotFound', id: 7 });
    expect(await client.health()).toBe('ok');
    expect((await drain(client.post.titles())).values).toEqual(['first', 'second']);
  });

  it('decodes class instances and typed errors over $effect', async () => {
    await using client = createClient(AppRouter, { link: localLink({ handlers: AppHandlers }) });
    const result = await Effect.runPromise(
      Effect.all({
        post: client.$effect.post.byId({ id: 1 }),
        missing: Effect.flip(client.$effect.post.byId({ id: 7 })),
        titles: Stream.runCollect(client.$effect.post.titles()),
      }),
    );
    expect(result.post).toBeInstanceOf(Post);
    expect(result.missing).toBeInstanceOf(PostNotFound);
    expect(result.titles).toEqual(['first', 'second']);
  });

  it('exposes the router built from the service as $router', async () => {
    await using client = createClient(AppRouter, { link: localLink({ handlers: AppHandlers }) });
    expect(client.$router).toBe(Router.from(AppRouter));
    expect([...client.$router.procedures.keys()]).toEqual(['health', 'post.byId', 'post.titles']);
  });
});
