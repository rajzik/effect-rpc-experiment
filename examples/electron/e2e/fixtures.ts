/**
 * The Electron suites' fixtures: how the shared scenarios reach the app.
 *
 * The app opens two windows at startup, one per user (`ada`, `guest`). A "board" is the window of
 * that user, found by its title, so `Boards.open('ada')` returns the page of the ada window. Every
 * board is guarded: a `pageerror` or `console.error` in any window fails the test at teardown.
 *
 * Two flavours of `test`:
 * - `sharedTest` runs against ONE app per worker (launched once, windows reloaded per test), so
 *   the isolation scenario really crosses tests inside a running process;
 * - `test` launches a fresh app per `launchApp()` call, for tests that close windows or inspect
 *   the app's own configuration.
 */
import { fileURLToPath } from 'node:url';

import {
  failOnConsoleErrors,
  TaskBoardPage,
  type Boards,
  type ConsoleErrorGuard,
  type TaskBoardAdapter,
} from '@effect-trpc-examples/shared/e2e';
import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

import { testHookKey } from '../src/testHook';

const appDir = fileURLToPath(new URL('..', import.meta.url));

/** Window title of a user's window (set by the main process). */
export const windowTitle = (name: string): string => `Task board: ${name}`;

/**
 * Launches the built app (`dist/main.mjs`). The first launch can download the Electron binary
 * (Electron has no postinstall), hence the generous timeout.
 */
export const launchApp = async (): Promise<ElectronApplication> =>
  await electron.launch({
    args: [
      '.',
      // Linux CI (no setuid chrome-sandbox helper, often root): Chromium refuses to start without it.
      ...(process.platform === 'linux' && process.env['CI'] ? ['--no-sandbox'] : []),
    ],
    cwd: appDir,
    env: { ...process.env, EXAMPLES_TEST: '1' },
    timeout: 120_000,
  });

/** The window whose title says it belongs to `name`. */
export const windowOf = async (app: ElectronApplication, name: string): Promise<Page> => {
  let found: Page | undefined;
  await expect
    .poll(
      async () => {
        for (const page of app.windows()) {
          const title = await (
            await app.browserWindow(page)
          ).evaluate((window) => window.getTitle());
          if (title === windowTitle(name)) {
            found = page;
            return true;
          }
        }
        return false;
      },
      { message: `the window of ${name}` },
    )
    .toBe(true);
  return found!;
};

/** Reloads the window on `hash`: a fresh renderer, client and subscription for every page visit. */
const show = async (page: Page, hash: string): Promise<void> => {
  await page.evaluate((next) => {
    location.hash = next;
  }, hash);
  await page.reload();
};

const windowAdapter = (page: Page): TaskBoardAdapter => ({
  // The window IS the user: the main process maps its `webContents.id` to a name.
  signIn: async () => {},
  gotoList: async () => {
    await show(page, '#/');
  },
  gotoTask: async (id) => {
    await show(page, `#/tasks/${id}`);
  },
});

/** {@link Boards} over the windows of `app`; `dispose()` throws when a window logged an error. */
export const windowBoards = (
  app: ElectronApplication,
): { readonly boards: Boards; readonly dispose: () => void } => {
  const guards: Array<ConsoleErrorGuard> = [];
  return {
    boards: {
      open: async (name) => {
        const page = await windowOf(app, name);
        guards.push(failOnConsoleErrors(page));
        return new TaskBoardPage(page, windowAdapter(page));
      },
    },
    dispose: () => {
      for (const guard of guards) guard.assertNone();
    },
  };
};

/** The number of live subscriptions to `tasks.onChanged`, read from the main process's store. */
export const subscriberCount = async (app: ElectronApplication): Promise<number> =>
  await app.evaluate(() => {
    const store: { changes: { subscribers: { size: number } } } = Reflect.get(
      globalThis,
      Symbol.for('@effect-trpc-examples/shared/store'),
    );
    return store.changes.subscribers.size;
  });

/** Resets the task data through the main process's test hook (which calls `testing.reset`). */
export const resetApp = async (app: ElectronApplication): Promise<void> => {
  await app.evaluate(async (_electron, key) => {
    const hook: { reset: () => Promise<void> } = Reflect.get(globalThis, Symbol.for(key));
    await hook.reset();
  }, testHookKey);
};

// One shared app per worker. `resetShared` is what `sharedScenarios` calls in `beforeEach`, where
// no fixture is available, so the app lives in a module-level promise that an auto fixture owns.
let shared: Promise<ElectronApplication> | undefined;

/** Resets the data of the worker's shared app. */
export const resetShared = async (): Promise<void> => {
  if (shared === undefined) throw new Error('the shared app is not running');
  await resetApp(await shared);
};

/** For tests that need their own app: closes everything it launched at teardown. */
export const test = base.extend<{
  launchApp: () => Promise<{ app: ElectronApplication; boards: Boards }>;
}>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads the fixture names from this destructuring and requires one, even when the fixture uses none
  launchApp: async ({}, use) => {
    const launched: Array<{ app: ElectronApplication; dispose: () => void }> = [];
    try {
      await use(async () => {
        const app = await launchApp();
        const web = windowBoards(app);
        launched.push({ app, dispose: web.dispose });
        return { app, boards: web.boards };
      });
      for (const entry of launched) entry.dispose();
    } finally {
      await Promise.all(launched.map(async ({ app }) => await app.close().catch(() => {})));
    }
  },
});

/** For the shared scenarios: a `boards` fixture over the worker's one app. */
export const sharedTest = base.extend<{ boards: Boards }, { sharedApp: ElectronApplication }>({
  sharedApp: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright reads the fixture names from this destructuring and requires one, even when the fixture uses none
    async ({}, use) => {
      shared = launchApp();
      const app = await shared;
      try {
        await use(app);
      } finally {
        await app.close().catch(() => {});
        shared = undefined;
      }
    },
    { scope: 'worker', auto: true, timeout: 180_000 },
  ],
  boards: async ({ sharedApp }, use) => {
    const web = windowBoards(sharedApp);
    await use(web.boards);
    web.dispose();
  },
});

export { expect };
