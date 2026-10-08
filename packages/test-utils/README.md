# @effect-trpc/test-utils

Shared test harness for [`@effect-trpc`](../../README.md) routers. One call starts a real Node
HTTP server on an ephemeral port and hands you everything needed to exercise a router end to end,
all bound to the same handler layer:

| Field          | What it is                                                                        |
| -------------- | --------------------------------------------------------------------------------- |
| `url`          | Absolute url of the rpc endpoint, e.g. `http://localhost:54321/rpc`               |
| `port`         | The ephemeral port                                                                |
| `client`       | Promise client (`createClient` + `httpLink({ url })`)                             |
| `effectClient` | The same client's Effect API (`client.$effect`)                                   |
| `fetch`        | A fetch web handler (`toWebHandler`) for raw `Request` → `Response` tests         |
| `caller`       | In-process caller (`createCaller`): Effect API, Promise API on `caller.$promise`  |
| `dispose()`    | Closes client, caller, web handler and server (the port is released). Idempotent. |

The result implements `Symbol.asyncDispose`, so `await using` cleans up even when a test throws.

## Install

```bash
pnpm add -D @effect-trpc/test-utils
```

## Example (vitest)

```ts
import { Effect, Schema, Stream } from 'effect';
import { query, Router, subscription } from '@effect-trpc/core';
import { RpcDefect } from '@effect-trpc/core';
import { Handlers } from '@effect-trpc/server';
import { assertInstance, testServerAndClient } from '@effect-trpc/test-utils';
import { describe, expect, it } from 'vitest';

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
```

## API

- **`testServerAndClient(router, { handlers, serialization?, path?, headers?, middleware? })`**
  → `Promise<TestServerAndClient<R>>`. `serialization` is `'ndjson'` (default) or `'json'` and is
  used by both server and client. `path` defaults to `'/rpc'`. `headers` are rpc headers the
  client sends with every call. `middleware` provides client-side middleware layers for routers
  using `requiredForClient` middleware. `ctx.fetch` accepts a `Request` or `(url, init)`;
  relative urls resolve against `ctx.url`.
- **`withTestServer(router, options, async (ctx) => ...)`** — runs the callback against a fresh
  harness and always disposes it, returning the callback's result.
- **`testWebHandler(router, { handlers, serialization?, path? })`** → `{ handler, fetch, url,
client, dispose }`: a `toWebHandler` fetch handler plus a Promise client whose `fetch` calls it
  directly — the full HTTP wire format without opening a port (how Next.js / TanStack Start
  adapters are exercised).
- **`testCaller(router, handlers)`** — `createCaller(router, { handlers })`; disposable.
- **`effectIt` / `effectExpect`** — `it` / `expect` from `@effect/vitest` (`effectIt.effect(...)`,
  `effectIt.layer(...)`).
- **`assertInstance(value, Cls, message?)`** — asserts and narrows `value instanceof Cls`, with a
  readable message. Handy for `Schema.Class` / `Schema.TaggedError` values that crossed the wire;
  inside `Effect.gen` a failed assertion is a defect that fails the test.

### Notes

- Server, web handler and caller each build the handler layer separately: state created inside
  the layer is not shared between them (state captured outside the layer is).
- `dispose()` closes the client first (interrupting in-flight calls), then the caller, the web
  handler and the server, and rethrows the first failure after running all of them.
