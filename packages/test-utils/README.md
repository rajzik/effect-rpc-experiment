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

## For AI agents

**Use this package when**

- you test an effect-trpc router end to end: real HTTP (`testServerAndClient`), the fetch
  wire format without a port (`testWebHandler`) or in-process calls (`testCaller`);
- you want `@effect/vitest` (`effectIt`) and `assertInstance` for values that crossed the wire.

Use a sibling instead in production code: serve with `@effect-trpc/server` (`toWebHandler`,
`runServer` from `@effect-trpc/server/node`), call with `@effect-trpc/client` (`createClient` +
`httpLink`). Define routers with `@effect-trpc/core`.

**Entry points**

| Import path               | Exports                                                                                                                                                        | Source            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `@effect-trpc/test-utils` | `testServerAndClient`, `withTestServer`, `testWebHandler`, `testCaller`, `TestServerAndClient`, `TestWebHandler`, `TestServerOptions`, `TestWebHandlerOptions` | `src/harness.ts`  |
| `@effect-trpc/test-utils` | `TestFetch` (and the shared options shape `TestHarnessOptions`)                                                                                                | `src/internal.ts` |
| `@effect-trpc/test-utils` | `effectIt`, `effectExpect` (`@effect/vitest` re-exports), `assertInstance`                                                                                     | `src/vitest.ts`   |

The barrel is `src/index.ts`; there are no subpath exports.

**Golden path** — one real server per test, disposed by `await using`:

```ts
import { Effect, Schema } from 'effect';
import { query, Router, RpcDefect } from '@effect-trpc/core';
import { Handlers } from '@effect-trpc/server';
import { assertInstance, testServerAndClient } from '@effect-trpc/test-utils';
import { describe, expect, it } from '@effect/vitest';

class User extends Schema.Class<User>('User')({ id: Schema.String, name: Schema.String }) {}
class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { id: Schema.String }) {}

const appRouter = Router.make({
  user: { byId: query({ payload: { id: Schema.String }, success: User, error: NotFound }) },
  boom: query({ success: Schema.String }),
});

// Handlers.make must implement every procedure (a missing one is a type error).
const HandlersLive = Handlers.make(appRouter, {
  user: {
    byId: ({ id }) =>
      id === 'ghost'
        ? Effect.fail(new NotFound({ id }))
        : Effect.succeed(new User({ id, name: 'Ada' })),
  },
  boom: () => Effect.die(new Error('kaboom')),
});

describe('appRouter', () => {
  it('works over real HTTP', async () => {
    await using ctx = await testServerAndClient(appRouter, { handlers: HandlersLive });

    expect(await ctx.client.user.byId({ id: '1' })).toBeInstanceOf(User);

    const error = await ctx.client.user.byId({ id: 'ghost' }).catch((e: unknown) => e);
    assertInstance(error, NotFound); // narrows `unknown` to NotFound
    expect(error.id).toBe('ghost');

    await expect(ctx.client.boom()).rejects.toBeInstanceOf(RpcDefect);
  }); // `await using` closed the server and released the port
});
```

**Invariants**

- `handlers` must implement every procedure of the router (`Handlers.make(router, {...})`); a partial layer is a type error.
- Every harness is disposable: `dispose()` / `Symbol.asyncDispose` run all finalizers once, rethrow the first failure and are idempotent.
- `ctx.url` is absolute (`http://localhost:<port><path>`, ephemeral port); `testWebHandler`'s `url` is `http://localhost<path>`; `path` defaults to `/rpc`.
- `serialization` defaults to `"ndjson"` and is used by both server and client (`"json"` is the alternative).
- `ctx.client` rejects with `ClientError<E> = E | RpcDefect | RpcTransportError | RpcInterrupted`; `ctx.effectClient` fails with `E | RpcTransportError` (server defects are defects).
- Server, web handler and caller each build the handler layer separately: state created inside the layer is not shared between them.
- Routers with `requiredForClient` middleware need the `middleware` option (client-side layers, also given to the caller).

**Common mistakes**

- Don't create a harness without disposing it → `await using ctx = …`, `withTestServer(...)` or `afterAll(() => ctx.dispose())`; otherwise the port stays open.
- Don't hard-code ports or urls → read `ctx.url` / `ctx.port`.
- Don't pass relative urls to the global `fetch` → use `ctx.fetch` / `web.fetch`, which resolve them against `url`.
- Don't expect state built inside the handler layer to be shared by `ctx.client` and `ctx.caller` → create shared state outside the layer.
- Don't test serialization with `testCaller` (no HTTP, no codecs) → use `testServerAndClient` or `testWebHandler`.
- Don't cast caught errors (`e as NotFound`) → `assertInstance(e, NotFound)` asserts and narrows.
- Inside this monorepo, don't import test APIs from `vitest` → use `vite-plus/test` or `@effect/vitest` (`effectIt`).

**Where to look**

| Behaviour                                                                    | Test                         |
| ---------------------------------------------------------------------------- | ---------------------------- |
| real server, ports, dispose, `fetch`, caller, `path`, `headers`, json/ndjson | `test/harness.test.ts`       |
| `withTestServer`, `testWebHandler`, `testCaller`, `assertInstance`           | `test/harness.test.ts`       |
| inferred client/caller types, rejected partial handler layers                | `test/harness.test-d.ts`     |
| `effectIt.effect` driving the Effect client                                  | `test/effect-vitest.test.ts` |
| this README's example                                                        | `test/readme.test.ts`        |
| JSDoc conventions (every export has examples)                                | `docs/jsdoc-style.md`        |

**Verify**

```bash
pnpm exec vp -C packages/test-utils test
pnpm exec vp -C packages/test-utils pack
node scripts/verify-jsdoc.mjs test-utils
```

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
- **`testWebHandler(router, { handlers, serialization?, path?, headers?, middleware? })`** → `{ handler, fetch, url,
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
