/**
 * The Electron suites' fixtures: how the shared scenarios reach the app.
 *
 * The app opens two windows at startup, one per user (`ada`, `guest`). A "board" is the window of
 * that user, found by its title, so `Boards.open('ada')` returns the page of the ada window. EVERY
 * window is guarded from the moment it appears (`watchWindows`), whether or not a test opens it: a
 * `pageerror` or `console.error` in any window fails the test at teardown.
 *
 * Two flavours of `test`:
 * - `sharedTest` runs against ONE app per worker (launched once, windows reloaded per test), so
 *   the isolation scenario really crosses tests inside a running process;
 * - `test` launches a fresh app per `launchApp()` call, for tests that close windows or inspect
 *   the app's own configuration.
 */
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
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
 * Whether Electron's `chrome-sandbox` helper is set up for the OS-level renderer sandbox on Linux:
 * owned by root with the setuid bit. `node_modules` does not install it that way; the examples
 * workflow does (`.github/workflows/examples.yml`).
 */
const sandboxHelperIsSetuid = (): boolean => {
  try {
    const electronPath: string = createRequire(import.meta.url)('electron');
    const stat = statSync(join(dirname(electronPath), 'chrome-sandbox'));
    return stat.uid === 0 && (stat.mode & 0o4000) !== 0;
  } catch {
    return false;
  }
};

/**
 * True when the app is launched with Chromium's `--no-sandbox`: renderers are then NOT OS-sandboxed,
 * whatever `webPreferences.sandbox` says. Only on Linux, and only when asked for
 * (`EXAMPLES_ELECTRON_NO_SANDBOX=1`) or in CI where the `chrome-sandbox` helper is not setuid.
 * Everywhere else (and in CI once the workflow fixed the helper) the sandbox stays on.
 */
export const noSandbox =
  process.platform === 'linux' &&
  (process.env['EXAMPLES_ELECTRON_NO_SANDBOX'] === '1' ||
    (process.env['CI'] !== undefined && !sandboxHelperIsSetuid()));

/**
 * Launches the built app (`dist/main.mjs`). The first launch can download the Electron binary
 * (Electron has no postinstall), hence the generous timeout; CI fetches it up front.
 */
export const launchApp = async (): Promise<ElectronApplication> =>
  await electron.launch({
    args: ['.', ...(noSandbox ? ['--no-sandbox'] : [])],
    cwd: appDir,
    env: { ...process.env, EXAMPLES_TEST: '1' },
    timeout: 120_000,
  });

/** Console-error guards over every window of an app. */
export interface WindowWatch {
  /**
   * Throws when any window (open or already closed) logged a `pageerror` / `console.error` since
   * the last call.
   */
  readonly assertNone: () => void;
  /** How many windows are watched. */
  readonly count: () => number;
}

/**
 * Guards every window of `app`, the ones that exist and every one that appears later, so no
 * window escapes the console-error check because a test did not open it.
 */
export const watchWindows = (app: ElectronApplication): WindowWatch => {
  const watched = new Map<Page, { guard: ConsoleErrorGuard; reported: number }>();
  const watch = (page: Page) => {
    if (!watched.has(page)) watched.set(page, { guard: failOnConsoleErrors(page), reported: 0 });
  };
  for (const page of app.windows()) watch(page);
  app.on('window', watch);
  return {
    count: () => watched.size,
    assertNone: () => {
      const fresh: Array<string> = [];
      for (const entry of watched.values()) {
        fresh.push(...entry.guard.errors.slice(entry.reported));
        entry.reported = entry.guard.errors.length;
      }
      if (fresh.length > 0) {
        throw new Error(`The windows logged ${fresh.length} error(s):\n${fresh.join('\n')}`);
      }
    },
  };
};

/**
 * Launches the app with every window guarded. Playwright attaches to a window only after it was
 * created, so whatever the first load logged is invisible to it: both windows are reloaded once
 * the guard is on, which puts a full load of each under watch.
 */
export const launchWatched = async (): Promise<{
  readonly app: ElectronApplication;
  readonly watch: WindowWatch;
}> => {
  const app = await launchApp();
  const watch = watchWindows(app);
  await expect.poll(() => watch.count(), { message: 'both windows opened' }).toBe(2);
  for (const page of app.windows()) await page.reload();
  return { app, watch };
};

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

/** {@link Boards} over the windows of `app` (the console guard is {@link watchWindows}). */
export const windowBoards = (app: ElectronApplication): Boards => ({
  open: async (name) => {
    const page = await windowOf(app, name);
    return new TaskBoardPage(page, windowAdapter(page));
  },
});

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
    const launched: Array<{ app: ElectronApplication; watch: WindowWatch }> = [];
    try {
      await use(async () => {
        const { app, watch } = await launchWatched();
        launched.push({ app, watch });
        return { app, boards: windowBoards(app) };
      });
      for (const { watch } of launched) watch.assertNone();
    } finally {
      await Promise.all(launched.map(async ({ app }) => await app.close().catch(() => {})));
    }
  },
});

/** For the shared scenarios: a `boards` fixture over the worker's one app. */
export const sharedTest = base.extend<
  { boards: Boards },
  { sharedApp: { app: ElectronApplication; watch: WindowWatch } }
>({
  sharedApp: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright reads the fixture names from this destructuring and requires one, even when the fixture uses none
    async ({}, use) => {
      const launching = launchWatched();
      shared = launching.then(({ app }) => app);
      const { app, watch } = await launching;
      try {
        await use({ app, watch });
      } finally {
        await app.close().catch(() => {});
        shared = undefined;
      }
    },
    { scope: 'worker', auto: true, timeout: 180_000 },
  ],
  boards: async ({ sharedApp }, use) => {
    await use(windowBoards(sharedApp.app));
    // Both windows are guarded, not only the ones this test opened.
    expect(sharedApp.watch.count()).toBe(2);
    // Both windows, opened by the test or not; the first test also covers the initial load.
    sharedApp.watch.assertNone();
  },
});

export { expect };
