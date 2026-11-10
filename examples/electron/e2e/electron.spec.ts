import type { TaskBoardPage } from '@rpc-effect-examples/shared/e2e';
import type { ElectronApplication } from '@playwright/test';

import { expect, noSandbox, subscriberCount, test, windowOf, windowTitle } from './fixtures';

test('two windows see different users', async ({ launchApp }) => {
  const { app, boards } = await launchApp();
  const ada = await boards.open('ada');
  const guest = await boards.open('guest');
  await ada.gotoList();
  await guest.gotoList();
  expect(ada.page).not.toBe(guest.page);
  // Same router, same server, same list; only the sender of the connection differs.
  await ada.expectSignedInAs('ada');
  await guest.expectSignedInAs('guest');
  await expect(ada.page.getByText('Signed in as guest')).toHaveCount(0);
  await expect(guest.page.getByText('Signed in as ada')).toHaveCount(0);
  // And the difference is enforced by the server, not displayed by the page.
  await guest.createTask('Guest task');
  await guest.expectAlert('Forbidden: guests cannot write');
  await ada.createTask('Ada task');
  await expect(ada.row('Ada task')).toBeVisible();
  expect(app.windows()).toHaveLength(2);
});

test('preload exposes nothing', async ({ launchApp }) => {
  const { app, boards } = await launchApp();
  for (const name of ['ada', 'guest']) {
    const board = await boards.open(name);
    await board.gotoList();
    // The bridge works (the list rendered through it), yet the page sees none of it.
    const exposed = await board.page.evaluate(() => ({
      ipcRenderer: typeof Reflect.get(window, 'ipcRenderer'),
      require: typeof Reflect.get(window, 'require'),
      electron: typeof Reflect.get(window, 'electron'),
      process: typeof Reflect.get(globalThis, 'process'),
    }));
    expect(exposed).toEqual({
      ipcRenderer: 'undefined',
      require: 'undefined',
      electron: 'undefined',
      process: 'undefined',
    });
    // What main.ts asked for, on every platform (`--no-sandbox` changes the process, not these
    // preferences): the behaviour above is the proof that context isolation took effect, and the
    // runtime sandbox test below the proof, where it can run, that `sandbox: true` did.
    const preferences = await (
      await app.browserWindow(board.page)
    ).evaluate((window) => {
      const { contextIsolation, nodeIntegration, sandbox } =
        window.webContents.getLastWebPreferences() ?? {};
      return { contextIsolation, nodeIntegration, sandbox };
    });
    expect(preferences.contextIsolation).toBe(true);
    expect(preferences.nodeIntegration).not.toBe(true);
    expect(preferences.sandbox).toBe(true);
  }
});

test('renderer processes run in an OS sandbox', async ({ launchApp }) => {
  // `getAppMetrics().sandboxed` is what Electron reports about the running processes (macOS and
  // Windows only), unlike `getLastWebPreferences()`, which only echoes what main.ts requested
  // (asserted on every platform in the test above). Skipped, not passed, where it cannot run.
  test.skip(
    noSandbox,
    'launched with --no-sandbox (Linux without a setuid chrome-sandbox helper, or EXAMPLES_ELECTRON_NO_SANDBOX=1): renderers are not OS-sandboxed in this run',
  );
  test.skip(
    process.platform !== 'darwin' && process.platform !== 'win32',
    `Electron does not report the sandbox state of processes on ${process.platform}`,
  );
  const { app, boards } = await launchApp();
  for (const name of ['ada', 'guest']) await (await boards.open(name)).gotoList();
  const renderers = await app.evaluate(({ app: electronApp }) =>
    electronApp
      .getAppMetrics()
      .filter((metric) => metric.type === 'Tab')
      .map((metric) => ({ pid: metric.pid, sandboxed: metric.sandboxed })),
  );
  expect(renderers.length).toBeGreaterThanOrEqual(2);
  expect(
    renderers.every((renderer) => renderer.sandboxed === true),
    JSON.stringify(renderers),
  ).toBe(true);
});

/** The number of `tasks.onChanged` subscriptions the main process holds, once both windows have one. */
const bothSubscribed = async (app: ElectronApplication): Promise<void> => {
  await expect.poll(async () => await subscriberCount(app)).toBe(2);
};

/** The remaining ada window still receives live changes. */
const expectAdaStillReceives = async (
  app: ElectronApplication,
  ada: TaskBoardPage,
): Promise<void> => {
  expect(await windowOf(app, 'ada')).toBe(ada.page);
  await ada.toggle('Publish the release notes');
  await ada.expectLive('Publish the release notes');
  expect(app.windows()).toHaveLength(1);
};

test('closing a window ends its subscription, the other keeps receiving', async ({ launchApp }) => {
  // The ordinary way: the user closes the page and the renderer unloads normally (its `pagehide`
  // handler runs). Not proof of the main process's own cleanup: see the destroyed-window test.
  const { app, boards } = await launchApp();
  const ada = await boards.open('ada');
  const guest = await boards.open('guest');
  await ada.gotoList();
  await guest.gotoList();
  await bothSubscribed(app);
  await guest.page.close();
  await expect.poll(async () => await subscriberCount(app)).toBe(1);
  await expectAdaStillReceives(app, ada);
});

test('a destroyed window ends its subscription without renderer cleanup, the other keeps receiving', async ({
  launchApp,
}) => {
  // The main process destroys the window: no `pagehide`, no `client.dispose()`, nothing from the
  // renderer. Only the main process noticing the closed port can end the subscription.
  const { app, boards } = await launchApp();
  const ada = await boards.open('ada');
  const guest = await boards.open('guest');
  await ada.gotoList();
  await guest.gotoList();
  await bothSubscribed(app);
  await app.evaluate(({ BrowserWindow }, title) => {
    BrowserWindow.getAllWindows()
      .find((window) => window.getTitle() === title)
      ?.destroy();
  }, windowTitle('guest'));
  await expect.poll(async () => await subscriberCount(app)).toBe(1);
  await expectAdaStillReceives(app, ada);
});
