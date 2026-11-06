// Spike: the generated router (`.inferred({ output, error })` injected) served over HTTP and called
// with `createClient`: class instances, Dates and typed errors decode; undeclared failures are
// defects; the client types (checked by lint's type-check) match. Run:
// `vp test --root packages/e2e/spike/infer-schemas`.
import { Effect, Layer, Stream } from 'effect';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vite-plus/test';
import { RpcDefect } from '@effect-trpc/core';
import type { ClientError } from '@effect-trpc/core';
import type { Router } from '@effect-trpc/core';
import { createClient, httpLink } from '@effect-trpc/client';
import type { Client } from '@effect-trpc/client';
import { Handlers, toWebHandler } from '@effect-trpc/server';
import type { WebHandler } from '@effect-trpc/server';

import { Auth, Forbidden, Post, PostNotFound, Unauthorized } from './models.ts';
import { AppRouter } from './router.gen.ts';

type Procedures = Router.Of<typeof AppRouter>['record'];

// Pass-through: the handler itself decides with the headers.
const AuthLive = Layer.succeed(Auth)(Auth.of((effect) => effect));

describe('spike: inferred schemas', () => {
  let web: WebHandler;
  let client: Client<Router.Of<typeof AppRouter>>;
  beforeAll(async () => {
    web = await toWebHandler(AppRouter, {
      handlers: Layer.mergeAll(Handlers.fromService(AppRouter), AuthLive),
    });
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

  it('client types come from the generated schemas', () => {
    expectTypeOf<Client.Output<Procedures['post']['byId']>>().toEqualTypeOf<Post>();
    expectTypeOf<Client.Error<Procedures['post']['byId']>>().toEqualTypeOf<
      ClientError<PostNotFound>
    >();
    // `DbError` (not a schema) is not a typed error: it arrives as `RpcDefect`.
    expectTypeOf<Client.Error<Procedures['post']['create']>>().toEqualTypeOf<
      ClientError<Forbidden>
    >();
    expectTypeOf<Client.Output<Procedures['post']['stats']>>().toEqualTypeOf<{
      readonly count: number;
      readonly latest: Date | undefined;
      readonly tags: ReadonlyArray<string>;
    }>();
    expectTypeOf<Client.Error<Procedures['post']['secret']>>().toEqualTypeOf<
      ClientError<Unauthorized>
    >();
  });

  it('a user `.error` with an inferred output; explicit chains untouched', async () => {
    expect(await client.post.first()).toBeInstanceOf(Post);
    expect(await client.post.title()).toBe('Posts');
  });

  it('middleware errors stay typed without being declared twice', async () => {
    expect(await client.post.secret().catch((e: unknown) => e)).toBeInstanceOf(Unauthorized);
    expect(await client.post.secret(undefined, { headers: { 'x-token': 'let-me-in' } })).toBe(
      's3cret',
    );
  });

  it('subscription elements are instances', async () => {
    const items = await Effect.runPromise(Stream.runCollect(client.$effect.post.onCreated()));
    expect(items.every((p) => p instanceof Post)).toBe(true);
  });
});
