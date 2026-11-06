// Spike: the generated router (inferred `.output` / `.error` injected) served over HTTP and called
// with `createClient`: class instances, Dates and typed errors decode; undeclared failures are
// defects. Run: `vp test --root packages/e2e/spike/infer-schemas`.
import { Effect, Stream } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { RpcDefect } from '@effect-trpc/core';
import type { Router } from '@effect-trpc/core';
import { createClient, httpLink } from '@effect-trpc/client';
import type { Client } from '@effect-trpc/client';
import { Handlers, toWebHandler } from '@effect-trpc/server';
import type { WebHandler } from '@effect-trpc/server';

import { Forbidden, Post, PostNotFound } from './models.ts';
import { AppRouter } from './router.gen.ts';

describe('spike: inferred schemas', () => {
  let web: WebHandler;
  let client: Client<Router.Of<typeof AppRouter>>;
  beforeAll(async () => {
    web = await toWebHandler(AppRouter, { handlers: Handlers.fromService(AppRouter) });
    client = createClient(AppRouter, {
      link: httpLink({
        url: 'http://localhost/rpc',
        fetch: (input, init) => web.handler(new Request(input, init)),
      }),
    });
  });
  afterAll(async () => {
    await client.dispose();
    await web.dispose();
  });

  it('literal output', async () => {
    expect(await client.health()).toBe('ok');
  });

  it('Schema.Class output arrives as an instance', async () => {
    const post = await client.post.byId({ id: 1 });
    expect(post).toBeInstanceOf(Post);
    expect(post.slug).toBe('hello-effect');
    expect(post.createdAt).toBeInstanceOf(Date);
  });

  it('inferred error arrives as the TaggedError instance', async () => {
    const error = await client.post.byId({ id: 9 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PostNotFound);
  });

  it('anonymous struct with nested classes, null, Date | undefined, string[]', async () => {
    const page = await client.post.list();
    expect(page.items[0]).toBeInstanceOf(Post);
    expect(page.nextCursor).toBe(2);
    const stats = await client.post.stats();
    expect(stats.latest).toBeInstanceOf(Date);
    expect(stats.tags).toEqual(['a', 'b']);
  });

  it('a Schema error from a union is typed; a Data.TaggedError is a defect', async () => {
    expect(await client.post.create({ title: '' }).catch((e: unknown) => e)).toBeInstanceOf(
      Forbidden,
    );
    expect(await client.post.create({ title: 'db' }).catch((e: unknown) => e)).toBeInstanceOf(
      RpcDefect,
    );
    expect(await client.post.create({ title: 'New' })).toBeInstanceOf(Post);
  });

  it('subscription elements are instances', async () => {
    const items = await Effect.runPromise(Stream.runCollect(client.$effect.post.onCreated()));
    expect(items.every((p) => p instanceof Post)).toBe(true);
  });
});
