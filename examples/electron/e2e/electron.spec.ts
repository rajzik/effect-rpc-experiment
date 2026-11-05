import { expect, subscriberCount, test, windowOf } from './fixtures';

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
    // What the main process asked for.
    const preferences = await (
      await app.browserWindow(board.page)
    ).evaluate((window) => {
      const { contextIsolation, sandbox, nodeIntegration } =
        window.webContents.getLastWebPreferences() ?? {};
      return { contextIsolation, sandbox, nodeIntegration };
    });
    expect(preferences).toMatchObject({ contextIsolation: true, sandbox: true });
    expect(preferences.nodeIntegration).not.toBe(true);
  }
});

test('closing a window ends its subscription, the other keeps receiving', async ({ launchApp }) => {
  const { app, boards } = await launchApp();
  const ada = await boards.open('ada');
  const guest = await boards.open('guest');
  await ada.gotoList();
  await guest.gotoList();
  // Each open window holds one `tasks.onChanged` subscription in the main process.
  await expect.poll(async () => await subscriberCount(app)).toBe(2);

  await guest.page.close();
  // Closing the window closes its port; the main process interrupts that connection's stream.
  await expect.poll(async () => await subscriberCount(app)).toBe(1);

  // The remaining window still receives live changes, and the app is still running.
  const adaPage = await windowOf(app, 'ada');
  expect(adaPage).toBe(ada.page);
  await ada.toggle('Publish the release notes');
  await ada.expectLive('Publish the release notes');
  expect(app.windows()).toHaveLength(1);
});
