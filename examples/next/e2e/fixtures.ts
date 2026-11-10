import { failOnConsoleErrors, httpBoards, type Boards } from '@rpc-effect-examples/shared/e2e';
import { test as base } from '@playwright/test';

/** The rpc endpoint the suites reset through (absolute: resolved outside any page). */
export const rpcUrl = 'http://localhost:3200/api/rpc';

/**
 * The suites' `test`. Every `page` is guarded: a `pageerror` or `console.error` (a hydration
 * mismatch, an uncaught error) fails the test at teardown, so no test has to remember to opt in.
 */
export const test = base.extend<{ boards: Boards }>({
  page: async ({ page }, use) => {
    const errors = failOnConsoleErrors(page);
    await use(page);
    errors.assertNone();
  },
  boards: async ({ browser, baseURL }, use) => {
    const web = httpBoards(browser, baseURL!);
    await use(web.boards);
    await web.dispose();
  },
});

export { expect } from '@playwright/test';
