/**
 * Option types and plumbing shared by the test harnesses in `harness.ts`.
 *
 * Only {@link TestFetch} and {@link TestHarnessOptions} (through `TestServerOptions` /
 * `TestWebHandlerOptions`) are public; the helpers build the `httpLink` client, merge the
 * caller's layer and make `dispose` idempotent.
 *
 * @since 0.1.0
 */
import { Layer } from 'effect';
import type { Router } from '@rpc-effect/core';
import { createClient, httpLink } from '@rpc-effect/client';
import type { Client, CreateClientOptions, HeadersOption } from '@rpc-effect/client';
import type { Caller, Handlers } from '@rpc-effect/server';

/** @internal Default route of the rpc endpoint (the server's default). */
export const DEFAULT_PATH = '/rpc' as const;

/**
 * A fetch-style request function that also accepts relative urls (`"/rpc"`).
 *
 * **Details**
 *
 * - A `Request` without `init` is passed through unchanged; a string url is resolved against the
 *   harness `url`, so `ctx.fetch('/rpc', init)` hits the rpc endpoint.
 *
 * **Example** (Sending a raw rpc request)
 *
 * ```ts
 * import type { TestFetch } from '@rpc-effect/test-utils';
 *
 * declare const fetchRpc: TestFetch; // e.g. `ctx.fetch` or `web.fetch`
 *
 * // a raw effect/rpc request frame, as an RpcClient sends it
 * const frame = { _tag: 'Request', id: '1', tag: 'health', payload: null, headers: [] };
 * const response = await fetchRpc('/rpc', {
 *   method: 'POST',
 *   headers: { 'content-type': 'application/ndjson' },
 *   body: `${JSON.stringify(frame)}\n`,
 * });
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export type TestFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Options shared by `testServerAndClient`, `withTestServer` and `testWebHandler` (exported as
 * `TestServerOptions` and `TestWebHandlerOptions`).
 *
 * **Gotchas**
 *
 * - `handlers` must implement every procedure of the router; a partial layer is a type error.
 * - `middleware` is only needed for routers whose middleware is declared with
 *   `requiredForClient: true`; a missing client middleware is reported at call time.
 *
 * @category options
 * @since 0.1.0
 */
export interface TestHarnessOptions<R extends Router.Any, LE = never> {
  /** Layer providing every handler of the router and its server middleware. */
  readonly handlers: Layer.Layer<Handlers.Requirements<R>, LE>;
  /** Wire format of server and client. Defaults to `"ndjson"`. */
  readonly serialization?: 'json' | 'ndjson' | undefined;
  /** Route of the rpc endpoint. Defaults to `"/rpc"`. */
  readonly path?: `/${string}` | undefined;
  /** Rpc headers the client sends with every call. */
  readonly headers?: HeadersOption | undefined;
  /**
   * Client-side middleware layers (`Middleware.layerClient(...)`), needed when the router uses
   * middleware declared with `requiredForClient: true`. Also provided to the in-process caller.
   */
  readonly middleware?: Layer.Layer<never, unknown> | undefined;
}

/** @internal Turns `fetch`-style arguments into a `Request`, resolving relative urls against `base`. */
export const toRequest = (base: string, input: string | URL | Request, init?: RequestInit) =>
  input instanceof Request && init === undefined
    ? input
    : new Request(typeof input === 'string' ? new URL(input, base) : input, init);

/** @internal A Promise client over `httpLink` for the harness options. */
export const makeHttpClient = <R extends Router.Any, LE>(
  router: R,
  url: string,
  options: TestHarnessOptions<R, LE>,
  fetch?: typeof globalThis.fetch,
): Client<R> => {
  const link = httpLink({
    url,
    ...(fetch === undefined ? {} : { fetch }),
    ...(options.serialization === undefined ? {} : { serialization: options.serialization }),
  });
  // `CreateClientOptions<R>` is a conditional type that stays unresolved for a generic `R`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- for a concrete `R` these fields are exactly `CreateClientOptions<R>`
  const clientOptions = {
    link,
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- the public `middleware` option accepts any layer error
    ...(options.middleware === undefined ? {} : { middleware: options.middleware }),
  } as unknown as CreateClientOptions<R>;
  return createClient(router, clientOptions);
};

/** @internal The caller's handler layer: the server handlers plus the optional client middleware. */
export const callerLayer = <R extends Router.Any, LE>(
  options: TestHarnessOptions<R, LE>,
): Layer.Layer<Caller.Requirements<R>, unknown> =>
  // Client-middleware requirements cannot be checked for a generic router; `createClient` and
  // `createCaller` report a missing client middleware at call time.
  options.middleware === undefined
    ? options.handlers
    : // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- the public `handlers` / `middleware` options accept any layer error
      Layer.merge(options.handlers, options.middleware);

/**
 * Runs the finalizers in order, each exactly once (even if an earlier one fails), and rethrows
 * the first failure. The returned function is idempotent: later calls share the first promise.
 *
 * @internal
 */
export const onceDispose = (
  finalizers: ReadonlyArray<() => Promise<void>>,
): (() => Promise<void>) => {
  let done: Promise<void> | undefined;
  const run = async (): Promise<void> => {
    const errors: Array<unknown> = [];
    for (const finalize of finalizers) {
      try {
        await finalize();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw errors[0];
  };
  return () => (done ??= run());
};

/**
 * Runs `make`; if it throws, awaits `release` and rethrows the original error (a failure of
 * `release` is dropped). Guards constructions that follow an acquisition.
 *
 * @internal
 */
export const releaseOnThrow = async <A>(
  make: () => A,
  release: () => Promise<void>,
): Promise<A> => {
  try {
    return make();
  } catch (error) {
    await Promise.allSettled([release()]);
    throw error;
  }
};
