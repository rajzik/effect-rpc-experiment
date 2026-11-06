/**
 * End-to-end test harnesses for effect-trpc routers: a real Node HTTP server, a fetch web
 * handler and an in-process caller, each bound to one handler layer.
 *
 * The harnesses compose the public adapters — `runServer` from `@effect-trpc/server/node`,
 * `toWebHandler` and `createCaller` from `@effect-trpc/server`, and `createClient` + `httpLink`
 * from `@effect-trpc/client` — so a test exercises exactly the wire format an app uses. Every
 * harness is disposable (`await using`).
 *
 * @since 0.1.0
 */
import type { Layer } from 'effect';
import { Router } from '@effect-trpc/core';
import type { Client } from '@effect-trpc/client';
import { createCaller, toWebHandler } from '@effect-trpc/server';
import type { Caller, WebHandler } from '@effect-trpc/server';
import { runServer } from '@effect-trpc/server/node';
import { callerLayer, DEFAULT_PATH, makeHttpClient, onceDispose, toRequest } from './internal.js';
import type { TestFetch, TestHarnessOptions } from './internal.js';

/**
 * Options of {@link testServerAndClient} and {@link withTestServer}.
 *
 * **Details**
 *
 * - `handlers` (required): a layer implementing every procedure, usually `Handlers.make(router,
 *   {...})`; a layer that misses procedures is a type error.
 * - `serialization`: `"ndjson"` (default) or `"json"`, used by server and client.
 * - `path`: route of the rpc endpoint, default `"/rpc"`.
 * - `headers`: rpc headers the client sends with every call.
 * - `middleware`: client-side middleware layers for `requiredForClient` middleware.
 *
 * **Example** (Sharing options between tests)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 * import { type TestServerOptions } from '@effect-trpc/test-utils';
 *
 * class User extends Schema.Class<User>('User')({ id: Schema.String, name: Schema.String }) {}
 * class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { id: Schema.String }) {}
 *
 * const appRouter = Router.make({
 *   user: { byId: query({ payload: { id: Schema.String }, success: User, error: NotFound }) },
 * });
 *
 * const HandlersLive = Handlers.make(appRouter, {
 *   user: {
 *     byId: ({ id }) =>
 *       id === 'ghost'
 *         ? Effect.fail(new NotFound({ id }))
 *         : Effect.succeed(new User({ id, name: 'Ada' })),
 *   },
 * });
 *
 * const options: TestServerOptions<typeof appRouter> = {
 *   handlers: HandlersLive,
 *   serialization: 'json',
 *   path: '/api/trpc',
 * };
 * ```
 *
 * @see {@link testServerAndClient}
 * @category options
 * @since 0.1.0
 */
export type TestServerOptions<R extends Router.Any, LE = never> = TestHarnessOptions<R, LE>;

/**
 * Options of {@link testWebHandler}: the same fields as {@link TestServerOptions}.
 *
 * **Example** (Web handler options)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 * import { type TestWebHandlerOptions } from '@effect-trpc/test-utils';
 *
 * class User extends Schema.Class<User>('User')({ id: Schema.String, name: Schema.String }) {}
 * class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { id: Schema.String }) {}
 *
 * const appRouter = Router.make({
 *   user: { byId: query({ payload: { id: Schema.String }, success: User, error: NotFound }) },
 * });
 *
 * const HandlersLive = Handlers.make(appRouter, {
 *   user: {
 *     byId: ({ id }) =>
 *       id === 'ghost'
 *         ? Effect.fail(new NotFound({ id }))
 *         : Effect.succeed(new User({ id, name: 'Ada' })),
 *   },
 * });
 *
 * const options: TestWebHandlerOptions<typeof appRouter> = { handlers: HandlersLive };
 * ```
 *
 * @see {@link testWebHandler}
 * @category options
 * @since 0.1.0
 */
export type TestWebHandlerOptions<R extends Router.Any, LE = never> = TestHarnessOptions<R, LE>;

/**
 * What {@link testServerAndClient} returns. Dispose it (or use `await using`).
 *
 * **Details**
 *
 * - `client`, `effectClient`, `fetch` and `caller` all run the same handler layer, but each
 *   adapter builds it separately: state created inside the layer is not shared between them
 *   (state captured outside the layer is).
 * - `dispose()` closes the client first (interrupting in-flight calls), then the caller, the web
 *   handler and the server; it runs all of them, rethrows the first failure and is idempotent.
 *
 * **Example** (Typing a shared fixture)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 * import { testServerAndClient, type TestServerAndClient } from '@effect-trpc/test-utils';
 * import { afterAll, beforeAll } from '@effect/vitest';
 *
 * class User extends Schema.Class<User>('User')({ id: Schema.String, name: Schema.String }) {}
 * class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { id: Schema.String }) {}
 *
 * const appRouter = Router.make({
 *   user: { byId: query({ payload: { id: Schema.String }, success: User, error: NotFound }) },
 * });
 *
 * const HandlersLive = Handlers.make(appRouter, {
 *   user: {
 *     byId: ({ id }) =>
 *       id === 'ghost'
 *         ? Effect.fail(new NotFound({ id }))
 *         : Effect.succeed(new User({ id, name: 'Ada' })),
 *   },
 * });
 *
 * let ctx: TestServerAndClient<typeof appRouter>;
 * beforeAll(async () => {
 *   ctx = await testServerAndClient(appRouter, { handlers: HandlersLive });
 * });
 * afterAll(() => ctx.dispose());
 * ```
 *
 * @see {@link testServerAndClient}
 * @category models
 * @since 0.1.0
 */
export interface TestServerAndClient<R extends Router.Any> {
  /** Absolute url of the rpc endpoint of the real server, e.g. `http://localhost:54321/rpc`. */
  readonly url: string;
  /** The port the server listens on (ephemeral). */
  readonly port: number;
  /** Promise client over `httpLink({ url })`; calls reject with `ClientError<E>`. */
  readonly client: Client<R>;
  /**
   * The same client's Effect API (`client.$effect`): calls fail with `E | RpcTransportError`;
   * server defects are defects and cancellation is interruption.
   */
  readonly effectClient: Client.Effect<R>;
  /**
   * A fetch-style web handler (`toWebHandler`) for the same router and handlers, for testing
   * fetch adapters without the network. Relative urls resolve against `url`.
   */
  readonly fetch: TestFetch;
  /** In-process caller (`createCaller`) for the same router and handlers. */
  readonly caller: Caller<R>;
  /** Closes the client, the caller, the web handler and the server. Idempotent. */
  readonly dispose: () => Promise<void>;
  /** Same as `dispose`; enables `await using`. */
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}

/**
 * What {@link testWebHandler} returns. Dispose it (or use `await using`).
 *
 * **Details**
 *
 * - `dispose()` closes the client, then the handler; it is idempotent.
 *
 * **Example** (Typing a web handler fixture)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 * import { testWebHandler, type TestWebHandler } from '@effect-trpc/test-utils';
 * import { afterAll, beforeAll } from '@effect/vitest';
 *
 * class User extends Schema.Class<User>('User')({ id: Schema.String, name: Schema.String }) {}
 * class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { id: Schema.String }) {}
 *
 * const appRouter = Router.make({
 *   user: { byId: query({ payload: { id: Schema.String }, success: User, error: NotFound }) },
 * });
 *
 * const HandlersLive = Handlers.make(appRouter, {
 *   user: {
 *     byId: ({ id }) =>
 *       id === 'ghost'
 *         ? Effect.fail(new NotFound({ id }))
 *         : Effect.succeed(new User({ id, name: 'Ada' })),
 *   },
 * });
 *
 * let web: TestWebHandler<typeof appRouter>;
 * beforeAll(async () => {
 *   web = await testWebHandler(appRouter, { handlers: HandlersLive });
 * });
 * afterAll(() => web.dispose());
 * ```
 *
 * @see {@link testWebHandler}
 * @category models
 * @since 0.1.0
 */
export interface TestWebHandler<R extends Router.Any> {
  /** The raw web handler (`Request` → `Response`). */
  readonly handler: WebHandler['handler'];
  /** `fetch` routed into the handler; relative urls resolve against `url`. */
  readonly fetch: TestFetch;
  /** The (virtual) url the client targets, e.g. `http://localhost/rpc`. */
  readonly url: string;
  /** Promise client over `httpLink` whose `fetch` calls the handler (no network). */
  readonly client: Client<R>;
  /** Closes the client and the handler. Idempotent. */
  readonly dispose: () => Promise<void>;
  /** Same as `dispose`; enables `await using`. */
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}

/** `testServerAndClient` for a router. */
const testServerAndClientFor = async <R extends Router.Any, LE = never>(
  router: R,
  options: TestServerOptions<R, LE>,
): Promise<TestServerAndClient<R>> => {
  const path = options.path ?? DEFAULT_PATH;
  const serverOptions = {
    handlers: options.handlers,
    path,
    ...(options.serialization === undefined ? {} : { serialization: options.serialization }),
  };
  const [server, web] = await Promise.allSettled([
    runServer(router, { ...serverOptions, port: 0 }),
    toWebHandler(router, serverOptions),
  ]);
  if (server.status === 'rejected' || web.status === 'rejected') {
    // Release whichever half started, then report the first failure.
    await Promise.allSettled([
      server.status === 'fulfilled' ? server.value.dispose() : undefined,
      web.status === 'fulfilled' ? web.value.dispose() : undefined,
    ]);
    if (server.status === 'rejected') throw server.reason;
    if (web.status === 'rejected') throw web.reason;
  }
  const { url, port } = server.value;
  const client = makeHttpClient(router, url, options);
  // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- the public `handlers` / `middleware` options accept any layer error
  const caller = createCaller(router, { handlers: callerLayer(options) });
  const handler = web.value.handler;
  const dispose = onceDispose([
    client.dispose,
    caller.dispose,
    web.value.dispose,
    server.value.dispose,
  ]);
  return {
    url,
    port,
    client,
    effectClient: client.$effect,
    fetch: (input, init) => handler(toRequest(url, input, init)),
    caller,
    dispose,
    [Symbol.asyncDispose]: dispose,
  };
};

/** `testServerAndClient` for a router or a router service: normalises the input with `Router.from`. */
const testServerAndClientFromInput = (
  input: Router.Input,
  options: TestServerOptions<Router.Any>,
): unknown => {
  const router: Router.Any = Router.from(input);
  return testServerAndClientFor(router, options);
};

/**
 * Starts the router on a real Node HTTP server (ephemeral port) and returns a Promise client, its
 * Effect API, a fetch web handler and an in-process caller, all bound to the same handlers.
 *
 * **When to use**
 *
 * Use for end-to-end tests over real HTTP (wire format, serialization, defects, streaming).
 * Prefer {@link testWebHandler} to skip the network, {@link testCaller} for in-process calls only,
 * and {@link withTestServer} when a callback scope reads better than `await using`.
 *
 * **Details**
 *
 * - `router` is a `Router.make` router or a router service class (`Router.Input`); a service is
 *   normalised with `Router.from` (its `make` runs once per process) and typed as `Router.Of<X>`.
 * - `url` is absolute (`http://localhost:<port>/rpc`); `client` uses `httpLink({ url })`.
 * - `client` rejects with `ClientError<E>`: the declared `Schema.TaggedError` instance, or
 *   `RpcDefect` / `RpcTransportError` / `RpcInterrupted`.
 * - `ctx.fetch` accepts a `Request` or `(url, init)`; relative urls resolve against `ctx.url`.
 * - Each adapter (server, web handler, caller) builds the handler layer separately.
 * - If the server or web handler fails to start, whichever half started is disposed and the
 *   first failure is rethrown.
 *
 * **Gotchas**
 *
 * - Always dispose (`await using`, `withTestServer` or `ctx.dispose()`), or the port stays open
 *   and the test runner hangs.
 *
 * **Example** (An end-to-end vitest test)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 * import { testServerAndClient } from '@effect-trpc/test-utils';
 * import { expect, it } from '@effect/vitest';
 *
 * class User extends Schema.Class<User>('User')({ id: Schema.String, name: Schema.String }) {}
 * class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { id: Schema.String }) {}
 *
 * const appRouter = Router.make({
 *   user: { byId: query({ payload: { id: Schema.String }, success: User, error: NotFound }) },
 * });
 *
 * const HandlersLive = Handlers.make(appRouter, {
 *   user: {
 *     byId: ({ id }) =>
 *       id === 'ghost'
 *         ? Effect.fail(new NotFound({ id }))
 *         : Effect.succeed(new User({ id, name: 'Ada' })),
 *   },
 * });
 *
 * it('returns users and typed errors', async () => {
 *   await using ctx = await testServerAndClient(appRouter, { handlers: HandlersLive });
 *
 *   const user = await ctx.client.user.byId({ id: 'ada' });
 *   expect(user).toBeInstanceOf(User); // Schema.Class instances survive the wire
 *
 *   const error = await ctx.client.user.byId({ id: 'ghost' }).catch((e: unknown) => e);
 *   expect(error).toBeInstanceOf(NotFound);
 *
 *   // the same router, in-process
 *   expect(await ctx.caller.$promise.user.byId({ id: 'x' })).toBeInstanceOf(User);
 * }); // `await using` closed the server here
 * ```
 *
 * @see {@link withTestServer}
 * @see {@link testWebHandler}
 * @category testing
 * @since 0.1.0
 */
export const testServerAndClient: {
  <R extends Router.Any, LE = never>(
    router: R,
    options: TestServerOptions<R, LE>,
  ): Promise<TestServerAndClient<R>>;
  <X extends Router.Input, LE = never>(
    router: X,
    options: TestServerOptions<Router.Of<X>, LE>,
  ): Promise<TestServerAndClient<Router.Of<X>>>;
} =
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- both overloads normalise the input with `Router.from` and continue with that router, which is what the implementation does; checking the overloads against it structurally instantiates `Router.Of<Router.Input>`, which is too deep
  testServerAndClientFromInput as unknown as typeof testServerAndClient;

/** `withTestServer` for a router. */
const withTestServerFor = async <R extends Router.Any, A, LE = never>(
  router: R,
  options: TestServerOptions<R, LE>,
  use: (ctx: TestServerAndClient<R>) => Promise<A>,
): Promise<A> => {
  const ctx = await testServerAndClient(router, options);
  try {
    return await use(ctx);
  } finally {
    await ctx.dispose();
  }
};

/** `withTestServer` for a router or a router service: normalises the input with `Router.from`. */
const withTestServerFromInput = (
  input: Router.Input,
  options: TestServerOptions<Router.Any>,
  use: (ctx: TestServerAndClient<Router.Any>) => Promise<unknown>,
): unknown => {
  const router: Router.Any = Router.from(input);
  return withTestServerFor(router, options, use);
};

/**
 * Runs `use` against a fresh {@link testServerAndClient} and disposes it afterwards, whether
 * `use` resolves or rejects.
 *
 * **When to use**
 *
 * Use when `await using` is not available (older runtimes or transpilers) or a callback scope
 * reads better. Returns whatever `use` returns; a rejection from `use` is rethrown after
 * disposal.
 *
 * **Details**
 *
 * - `router` is a `Router.make` router or a router service class (`Router.Input`); a service is
 *   normalised with `Router.from` (its `make` runs once per process) and typed as `Router.Of<X>`.
 *
 * **Example** (Scoped server for one assertion)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 * import { withTestServer } from '@effect-trpc/test-utils';
 * import { expect, it } from '@effect/vitest';
 *
 * class User extends Schema.Class<User>('User')({ id: Schema.String, name: Schema.String }) {}
 * class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { id: Schema.String }) {}
 *
 * const appRouter = Router.make({
 *   user: { byId: query({ payload: { id: Schema.String }, success: User, error: NotFound }) },
 * });
 *
 * const HandlersLive = Handlers.make(appRouter, {
 *   user: {
 *     byId: ({ id }) =>
 *       id === 'ghost'
 *         ? Effect.fail(new NotFound({ id }))
 *         : Effect.succeed(new User({ id, name: 'Ada' })),
 *   },
 * });
 *
 * it('finds a user', async () => {
 *   const name = await withTestServer(appRouter, { handlers: HandlersLive }, async (ctx) => {
 *     const user = await ctx.client.user.byId({ id: '1' });
 *     return user.name;
 *   }); // the server is closed here
 *   expect(name).toBe('Ada');
 * });
 * ```
 *
 * @see {@link testServerAndClient}
 * @category testing
 * @since 0.1.0
 */
export const withTestServer: {
  <R extends Router.Any, A, LE = never>(
    router: R,
    options: TestServerOptions<R, LE>,
    use: (ctx: TestServerAndClient<R>) => Promise<A>,
  ): Promise<A>;
  <X extends Router.Input, A, LE = never>(
    router: X,
    options: TestServerOptions<Router.Of<X>, LE>,
    use: (ctx: TestServerAndClient<Router.Of<X>>) => Promise<A>,
  ): Promise<A>;
} =
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- both overloads normalise the input with `Router.from` and continue with that router, which is what the implementation does; checking the overloads against it structurally instantiates `Router.Of<Router.Input>`, which is too deep
  withTestServerFromInput as unknown as typeof withTestServer;

/** `testWebHandler` for a router. */
const testWebHandlerFor = async <R extends Router.Any, LE = never>(
  router: R,
  options: TestWebHandlerOptions<R, LE>,
): Promise<TestWebHandler<R>> => {
  const path = options.path ?? DEFAULT_PATH;
  const web = await toWebHandler(router, {
    handlers: options.handlers,
    path,
    ...(options.serialization === undefined ? {} : { serialization: options.serialization }),
  });
  const url = `http://localhost${path}`;
  const fetch: TestFetch = (input, init) => web.handler(toRequest(url, input, init));
  const client = makeHttpClient(router, url, options, fetch);
  const dispose = onceDispose([client.dispose, web.dispose]);
  return {
    handler: web.handler,
    fetch,
    url,
    client,
    dispose,
    [Symbol.asyncDispose]: dispose,
  };
};

/** `testWebHandler` for a router or a router service: normalises the input with `Router.from`. */
const testWebHandlerFromInput = (
  input: Router.Input,
  options: TestWebHandlerOptions<Router.Any>,
): unknown => {
  const router: Router.Any = Router.from(input);
  return testWebHandlerFor(router, options);
};

/**
 * Builds a fetch web handler (`toWebHandler`) and a Promise client whose `fetch` calls it
 * directly — the full HTTP wire format without opening a port.
 *
 * **When to use**
 *
 * Use to test fetch-based adapters (Next.js route handlers, TanStack Start, workers) or when
 * opening ports is undesirable. Prefer {@link testServerAndClient} to test the Node server.
 *
 * **Details**
 *
 * - `router` is a `Router.make` router or a router service class (`Router.Input`); a service is
 *   normalised with `Router.from` (its `make` runs once per process) and typed as `Router.Of<X>`.
 * - `url` is the virtual `http://localhost<path>` (default `http://localhost/rpc`).
 * - `handler` is the raw `Request` → `Response` function; `fetch` resolves relative urls
 *   against `url` before calling it.
 *
 * **Example** (Testing over the fetch handler)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 * import { testWebHandler } from '@effect-trpc/test-utils';
 * import { expect, it } from '@effect/vitest';
 *
 * class User extends Schema.Class<User>('User')({ id: Schema.String, name: Schema.String }) {}
 * class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { id: Schema.String }) {}
 *
 * const appRouter = Router.make({
 *   user: { byId: query({ payload: { id: Schema.String }, success: User, error: NotFound }) },
 * });
 *
 * const HandlersLive = Handlers.make(appRouter, {
 *   user: {
 *     byId: ({ id }) =>
 *       id === 'ghost'
 *         ? Effect.fail(new NotFound({ id }))
 *         : Effect.succeed(new User({ id, name: 'Ada' })),
 *   },
 * });
 *
 * it('serves the client without a port', async () => {
 *   await using web = await testWebHandler(appRouter, { handlers: HandlersLive });
 *   expect(web.url).toBe('http://localhost/rpc');
 *   expect(await web.client.user.byId({ id: '1' })).toBeInstanceOf(User);
 * });
 * ```
 *
 * @see {@link testServerAndClient}
 * @category testing
 * @since 0.1.0
 */
export const testWebHandler: {
  <R extends Router.Any, LE = never>(
    router: R,
    options: TestWebHandlerOptions<R, LE>,
  ): Promise<TestWebHandler<R>>;
  <X extends Router.Input, LE = never>(
    router: X,
    options: TestWebHandlerOptions<Router.Of<X>, LE>,
  ): Promise<TestWebHandler<Router.Of<X>>>;
} =
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- both overloads normalise the input with `Router.from` and continue with that router, which is what the implementation does; checking the overloads against it structurally instantiates `Router.Of<Router.Input>`, which is too deep
  testWebHandlerFromInput as unknown as typeof testWebHandler;

/** `testCaller` for a router. */
const testCallerFor = <R extends Router.Any, LE = never>(
  router: R,
  handlers: Layer.Layer<Caller.Requirements<R>, LE>,
): Caller<R> => createCaller(router, { handlers });

/** `testCaller` for a router or a router service: normalises the input with `Router.from`. */
const testCallerFromInput = (
  input: Router.Input,
  handlers: Layer.Layer<Caller.Requirements<Router.Any>>,
): unknown => {
  const router: Router.Any = Router.from(input);
  return testCallerFor(router, handlers);
};

/**
 * An in-process caller for tests (`createCaller(router, { handlers })`): Effect API on the
 * caller, Promise API on `caller.$promise`. Dispose it (or use `await using`).
 *
 * **When to use**
 *
 * Use for fast handler tests without HTTP or serialization. Use {@link testServerAndClient} when
 * the wire format matters.
 *
 * **Details**
 *
 * - `router` is a `Router.make` router or a router service class (`Router.Input`); a service is
 *   normalised with `Router.from` (its `make` runs once per process) and typed as `Router.Of<X>`.
 * - Effect calls fail with the procedure's typed error; `$promise` calls reject with
 *   `ClientError<E>` (defects become `RpcDefect`).
 *
 * **Example** (Calling a handler in-process)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 * import { testCaller } from '@effect-trpc/test-utils';
 * import { expect, it } from '@effect/vitest';
 *
 * class User extends Schema.Class<User>('User')({ id: Schema.String, name: Schema.String }) {}
 * class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { id: Schema.String }) {}
 *
 * const appRouter = Router.make({
 *   user: { byId: query({ payload: { id: Schema.String }, success: User, error: NotFound }) },
 * });
 *
 * const HandlersLive = Handlers.make(appRouter, {
 *   user: {
 *     byId: ({ id }) =>
 *       id === 'ghost'
 *         ? Effect.fail(new NotFound({ id }))
 *         : Effect.succeed(new User({ id, name: 'Ada' })),
 *   },
 * });
 *
 * it('calls in-process', async () => {
 *   await using caller = testCaller(appRouter, HandlersLive);
 *   expect(await Effect.runPromise(caller.user.byId({ id: '1' }))).toBeInstanceOf(User);
 *   await expect(caller.$promise.user.byId({ id: 'ghost' })).rejects.toBeInstanceOf(NotFound);
 * });
 * ```
 *
 * @see {@link testServerAndClient}
 * @category testing
 * @since 0.1.0
 */
export const testCaller: {
  <R extends Router.Any, LE = never>(
    router: R,
    handlers: Layer.Layer<Caller.Requirements<R>, LE>,
  ): Caller<R>;
  <X extends Router.Input, LE = never>(
    router: X,
    handlers: Layer.Layer<Caller.Requirements<Router.Of<X>>, LE>,
  ): Caller<Router.Of<X>>;
} =
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- both overloads normalise the input with `Router.from` and continue with that router, which is what the implementation does; checking the overloads against it structurally instantiates `Router.Of<Router.Input>`, which is too deep
  testCallerFromInput as unknown as typeof testCaller;
