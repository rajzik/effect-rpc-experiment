/**
 * Public entry of `@effect-trpc/test-utils`: test harnesses and vitest helpers for effect-trpc
 * routers.
 *
 * `testServerAndClient` / `withTestServer` run a router on a real Node HTTP server,
 * `testWebHandler` serves it through a fetch handler without a port and `testCaller` calls it
 * in-process. All of them are built from the public `@effect-trpc/server` and
 * `@effect-trpc/client` adapters, so tests exercise the same code paths as an app.
 *
 * @since 0.1.0
 */
export {
  testCaller,
  testServerAndClient,
  testWebHandler,
  withTestServer,
  type TestServerAndClient,
  type TestServerOptions,
  type TestWebHandler,
  type TestWebHandlerOptions,
} from './harness.js';
export type { TestFetch } from './internal.js';
export { assertInstance, effectExpect, effectIt } from './vitest.js';
