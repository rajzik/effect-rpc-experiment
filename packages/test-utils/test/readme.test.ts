// The README example, verbatim apart from imports (source paths instead of package names).
import { Effect, Schema, Stream } from 'effect';
import { query, Router, subscription } from '@effect-trpc/core';
import { RpcDefect } from '@effect-trpc/core';
import { Handlers } from '@effect-trpc/server';
import { describe, expect, it } from 'vite-plus/test';
import { assertInstance, testServerAndClient } from '../src/index.js';

class User extends Schema.Class<User>('User')({
  id: Schema.String,
  createdAt: Schema.Date,
}) {
  greet() {
    return `hi ${this.id}`;
  }
}
class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { id: Schema.String }) {}

const appRouter = Router.make({
  user: {
    byId: query({ payload: { id: Schema.String }, success: User, error: NotFound }),
    ticks: subscription({ payload: { n: Schema.Number }, success: Schema.Number }),
  },
  boom: query({ success: Schema.String }),
});

const HandlersLive = Handlers.make(appRouter, {
  user: {
    byId: ({ id }) =>
      id === 'missing'
        ? Effect.fail(new NotFound({ id }))
        : Effect.succeed(new User({ id, createdAt: new Date(0) })),
    ticks: ({ n }) => Stream.range(0, n - 1),
  },
  boom: () => Effect.die(new Error('kaboom')),
});

describe('appRouter', () => {
  it('works end to end', async () => {
    await using ctx = await testServerAndClient(appRouter, { handlers: HandlersLive });

    // Schema.Class instances survive the wire (methods, Dates)
    const user = await ctx.client.user.byId({ id: 'ada' });
    expect(user.greet()).toBe('hi ada');

    // typed failures reject with the TaggedError instance
    const error = await ctx.client.user.byId({ id: 'missing' }).catch((e: unknown) => e);
    assertInstance(error, NotFound);
    expect(error.id).toBe('missing');

    // defects are RpcDefect; the server keeps serving
    await expect(ctx.client.boom()).rejects.toBeInstanceOf(RpcDefect);

    // subscriptions are async iterables
    const ticks: Array<number> = [];
    for await (const tick of ctx.client.user.ticks({ n: 3 })) ticks.push(tick);
    expect(ticks).toEqual([0, 1, 2]);

    // the Effect API: errors are typed (NotFound | RpcTransportError)
    const exit = await Effect.runPromiseExit(ctx.effectClient.user.byId({ id: 'missing' }));
    expect(exit._tag).toBe('Failure');

    // in-process caller, no HTTP
    expect(await ctx.caller.$promise.user.byId({ id: 'x' })).toBeInstanceOf(User);
  }); // `await using` disposed the server here: the port is closed
});
