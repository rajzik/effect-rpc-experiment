import { Layer } from 'effect';
import type { Router } from '@effect-trpc/core';
import { createClient, httpLink } from '@effect-trpc/client';
import type { Client, CreateClientOptions, HeadersOption } from '@effect-trpc/client';
import type { Caller, Handlers } from '@effect-trpc/server';

/** Default route of the rpc endpoint (the server's default). */
export const DEFAULT_PATH = '/rpc' as const;

/** A fetch-style request function that also accepts relative urls (`"/rpc"`). */
export type TestFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Options shared by {@link testServerAndClient} and {@link testWebHandler}. */
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

/** Turns `fetch`-style arguments into a `Request`, resolving relative urls against `base`. */
export const toRequest = (base: string, input: string | URL | Request, init?: RequestInit) =>
  input instanceof Request && init === undefined
    ? input
    : new Request(typeof input === 'string' ? new URL(input, base) : input, init);

/** A Promise client over `httpLink` for the harness options. */
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
  const clientOptions = {
    link,
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(options.middleware === undefined ? {} : { middleware: options.middleware }),
  } as unknown as CreateClientOptions<R>;
  return createClient(router, clientOptions);
};

/** The caller's handler layer: the server handlers plus the optional client middleware. */
export const callerLayer = <R extends Router.Any, LE>(
  options: TestHarnessOptions<R, LE>,
): Layer.Layer<Caller.Requirements<R>, unknown> =>
  // Client-middleware requirements cannot be checked for a generic router; `createClient` and
  // `createCaller` report a missing client middleware at call time.
  options.middleware === undefined
    ? options.handlers
    : Layer.merge(options.handlers, options.middleware);

/**
 * Runs the finalizers in order, each exactly once (even if an earlier one fails), and rethrows
 * the first failure. The returned function is idempotent: later calls share the first promise.
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
