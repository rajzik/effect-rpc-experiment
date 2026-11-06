/**
 * The test hook the main process installs when `EXAMPLES_TEST=1`: `globalThis[Symbol.for(key)]`
 * holds `{ reset }`, which Playwright reaches with `electronApp.evaluate`. It calls the router's
 * own `testing.reset` procedure in process (which enforces the same `EXAMPLES_TEST` guard), so a
 * suite can reset the data without a window.
 */
export const testHookKey = 'effect-trpc-examples/electron/test-hook';

/** What the hook offers. */
export interface TestHook {
  readonly reset: () => Promise<void>;
}
