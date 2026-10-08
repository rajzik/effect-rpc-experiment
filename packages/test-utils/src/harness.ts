import type { Layer } from 'effect';
import type { Router } from '@effect-trpc/core';
import type { Client } from '@effect-trpc/client';
import { createCaller, toWebHandler } from '@effect-trpc/server';
import type { Caller, WebHandler } from '@effect-trpc/server';
import { runServer } from '@effect-trpc/server/node';
import { callerLayer, DEFAULT_PATH, makeHttpClient, onceDispose, toRequest } from './internal.js';
import type { TestFetch, TestHarnessOptions } from './internal.js';

/** Options of {@link testServerAndClient} and {@link withTestServer}. */
export type TestServerOptions<R extends Router.Any, LE = never> = TestHarnessOptions<R, LE>;

/** Options of {@link testWebHandler}. */
export type TestWebHandlerOptions<R extends Router.Any, LE = never> = TestHarnessOptions<R, LE>;

/** What {@link testServerAndClient} returns. Dispose it (or use `await using`). */
export interface TestServerAndClient<R extends Router.Any> {
  /** Absolute url of the rpc endpoint of the real server, e.g. `http://localhost:54321/rpc`. */
  readonly url: string;
  /** The port the server listens on (ephemeral). */
  readonly port: number;
  /** Promise client over `httpLink({ url })`. */
  readonly client: Client<R>;
  /** The same client's Effect API (`client.$effect`). */
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
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}

/** What {@link testWebHandler} returns. Dispose it (or use `await using`). */
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
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}

/**
 * Starts the router on a real Node HTTP server (ephemeral port) and returns a Promise client, its
 * Effect API, a fetch web handler and an in-process caller, all bound to the same handlers.
 *
 * ```ts
 * await using ctx = await testServerAndClient(appRouter, { handlers: HandlersLive });
 * const user = await ctx.client.user.byId({ id: '1' }); // User instance
 * ```
 *
 * Each adapter (server, web handler, caller) builds the handler layer separately.
 */
export const testServerAndClient = async <R extends Router.Any, LE = never>(
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

/**
 * Runs `use` against a fresh {@link testServerAndClient} and disposes it afterwards, whether
 * `use` resolves or rejects.
 */
export const withTestServer = async <R extends Router.Any, A, LE = never>(
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

/**
 * Builds a fetch web handler (`toWebHandler`) and a Promise client whose `fetch` calls it
 * directly — the full HTTP wire format without opening a port.
 */
export const testWebHandler = async <R extends Router.Any, LE = never>(
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

/**
 * An in-process caller for tests (`createCaller(router, { handlers })`): Effect API on the
 * caller, Promise API on `caller.$promise`. Dispose it (or use `await using`).
 */
export const testCaller = <R extends Router.Any, LE = never>(
  router: R,
  handlers: Layer.Layer<Caller.Requirements<R>, LE>,
): Caller<R> => createCaller(router, { handlers });
