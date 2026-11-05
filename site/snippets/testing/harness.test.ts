// post.test.ts
import { Effect } from 'effect';
import { describe, expect, it } from '@effect/vitest';
import { assertInstance, testServerAndClient, withTestServer } from '@effect-trpc/test-utils';

import { appRouter, Post, PostNotFound, Unauthorized } from '@/router';
import { ServerLive } from '@/server';

// #region harness
describe('post router', () => {
  it('works end to end over real HTTP', async () => {
    // A Node server on a free port, a Promise client, an Effect client and a caller.
    await using ctx = await testServerAndClient(appRouter, {
      handlers: ServerLive,
      headers: { authorization: 'Bearer ada' }, // sent with every call
    });

    // Classes survive the wire.
    const post = await ctx.client.post.byId({ id: 1 });
    assertInstance(post, Post);
    expect(post.slug).toBe('hello-effect');

    // Typed failures reject with the TaggedError instance.
    const error = await ctx.client.post.byId({ id: 404 }).catch((e: unknown) => e);
    assertInstance(error, PostNotFound);
    expect(error.id).toBe(404);

    // Subscriptions are async iterables.
    const titles: Array<string> = [];
    for await (const created of ctx.client.post.onCreated()) titles.push(created.title);
    expect(titles).toHaveLength(3);

    // The Effect API.
    const exit = await Effect.runPromiseExit(ctx.effectClient.post.byId({ id: 404 }));
    expect(exit._tag).toBe('Failure');

    // The in-process caller: no HTTP.
    expect(await ctx.caller.$promise.health()).toBe('ok');
  }); // `await using` disposed everything here: the port is closed
});
// #endregion harness

// #region with
it('rejects unauthenticated mutations', () =>
  withTestServer(appRouter, { handlers: ServerLive }, async (ctx) => {
    const error = await ctx.client.post.create({ title: 'x' }).catch((e: unknown) => e);
    assertInstance(error, Unauthorized);
  }));
// #endregion with
