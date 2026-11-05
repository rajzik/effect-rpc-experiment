/**
 * `failOnConsoleErrors`: turns an uncaught page error or a `console.error` into a test failure.
 * It is what makes hydration mismatches and runtime errors visible in tests that otherwise pass.
 */
import type { Page } from '@playwright/test';

/** What {@link failOnConsoleErrors} collected. */
export interface ConsoleErrorGuard {
  /** One line per `pageerror` / `console.error` seen so far. */
  readonly errors: ReadonlyArray<string>;
  /** Throws when anything was collected; call it when the test ends. */
  readonly assertNone: () => void;
}

/**
 * Starts collecting `pageerror` events and `console.error` messages of `page`.
 *
 * Call `assertNone()` at the end of the test, e.g. in the teardown of a `page` fixture:
 *
 * ```ts
 * page: async ({ page }, use) => {
 *   const guard = failOnConsoleErrors(page);
 *   await use(page);
 *   guard.assertNone();
 * },
 * ```
 *
 * `httpBoards` does this for every page it opens.
 */
export const failOnConsoleErrors = (page: Page): ConsoleErrorGuard => {
  const errors: Array<string> = [];
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.stack ?? error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  return {
    errors,
    assertNone: () => {
      if (errors.length > 0) {
        throw new Error(`The page logged ${errors.length} error(s):\n${errors.join('\n')}`);
      }
    },
  };
};
