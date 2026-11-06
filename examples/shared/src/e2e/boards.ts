/**
 * `Boards`: the fixture `sharedScenarios` needs, a way to open the task board as a given user.
 * `httpBoards` implements it for the web apps (one fresh browser context per board).
 */
import type { Browser, BrowserContext } from '@playwright/test';

import { failOnConsoleErrors, type ConsoleErrorGuard } from './console';
import { httpAdapter, TaskBoardPage } from './TaskBoardPage';

/** Opens task boards. */
export interface Boards {
  /**
   * A board signed in as `name` (`ada`, `grace` or `guest`) on its own page or window, not yet
   * navigated. Opening `ada` twice in a test yields the same user in two places for web apps; the
   * Electron suite maps each user to one window.
   */
  readonly open: (name: string) => Promise<TaskBoardPage>;
}

/**
 * {@link Boards} for web apps: every `open` creates a browser context (own cookies, own
 * `QueryClient`) with `baseURL`, signs in with a cookie and watches the page for console errors.
 *
 * Call `dispose()` in the fixture teardown: it closes the contexts, then throws if any page logged
 * an error.
 *
 * ```ts
 * boards: async ({ browser, baseURL }, use) => {
 *   const web = httpBoards(browser, baseURL!);
 *   await use(web.boards);
 *   await web.dispose();
 * },
 * ```
 */
export const httpBoards = (
  browser: Browser,
  baseURL: string,
): { readonly boards: Boards; readonly dispose: () => Promise<void> } => {
  const contexts: Array<BrowserContext> = [];
  const guards: Array<ConsoleErrorGuard> = [];
  return {
    boards: {
      open: async (name) => {
        const context = await browser.newContext({ baseURL });
        contexts.push(context);
        const page = await context.newPage();
        guards.push(failOnConsoleErrors(page));
        const board = new TaskBoardPage(page, httpAdapter(page, baseURL));
        await board.signIn(name);
        return board;
      },
    },
    dispose: async () => {
      try {
        await Promise.all(contexts.map((context) => context.close()));
      } finally {
        for (const guard of guards) guard.assertNone();
      }
    },
  };
};
