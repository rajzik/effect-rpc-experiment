/**
 * The main process: hosts the task board's server and opens one window per user.
 *
 * `MainRpcServer` serves the shared router over a `MessagePort` per renderer connection. A request
 * has no cookie here: the server stamps every connection with the `webContents.id` of the window
 * that opened it (`MainRpcServer.senderId(headers)`), and `resolveUser` maps that id to the user
 * the window was opened for. The page cannot choose or spoof it.
 */
import { createCaller } from '@rpc-effect/server';
import { MainRpcServer } from '@rpc-effect/electron/main';
import { appRouter } from '@rpc-effect-examples/shared';
import { makeServerLive } from '@rpc-effect-examples/shared/server';
import { app, BrowserWindow, ipcMain } from 'electron';
import { pathToFileURL } from 'node:url';

import { testHookKey, type TestHook } from './testHook';

/** The windows of the app: the first one is `ada` (a member), the second one `guest`. */
const windowUsers = ['ada', 'guest'] as const;

/** `webContents.id` of each window -> the user it was opened for. */
const userBySender = new Map<number, string>();

const testing = process.env['EXAMPLES_TEST'] === '1';
const rendererDir = `${import.meta.dirname}/renderer`;
const rendererUrl = pathToFileURL(rendererDir).href;

const ServerLive = makeServerLive({
  resolveUser: (headers) => {
    const id = MainRpcServer.senderId(headers);
    return id === undefined ? undefined : userBySender.get(id);
  },
});

const openWindow = async (user: string): Promise<void> => {
  const window = new BrowserWindow({
    title: `Task board: ${user}`,
    width: 640,
    height: 720,
    // Hidden while testing: the suite drives the page, nobody needs to look at it.
    show: !testing,
    webPreferences: {
      preload: `${import.meta.dirname}/preload.cjs`,
      contextIsolation: true,
      sandbox: true,
      // Hidden windows must not throttle timers, or live updates would arrive late in tests.
      backgroundThrottling: !testing,
    },
  });
  // The title names the user; the page's own <title> must not replace it.
  window.on('page-title-updated', (event) => {
    event.preventDefault();
  });
  // `webContents` is destroyed once the window is closed: capture the id now.
  const senderId = window.webContents.id;
  userBySender.set(senderId, user);
  window.on('closed', () => {
    userBySender.delete(senderId);
  });
  await window.loadFile(`${rendererDir}/index.html`);
};

const main = async (): Promise<void> => {
  await app.whenReady();
  const server = await MainRpcServer.run(appRouter, {
    handlers: ServerLive,
    ipcMain,
    // Only pages of this app's renderer bundle may open a connection.
    authorize: (event) => event.senderFrame?.url.startsWith(rendererUrl) === true,
  });
  app.on('will-quit', () => void server.dispose());
  app.on('window-all-closed', () => {
    app.quit();
  });

  if (testing) {
    // Lets the Playwright suite reset the data without a window: `testing.reset` in process.
    const caller = createCaller(appRouter, { handlers: ServerLive });
    const hook: TestHook = {
      reset: async () => {
        await caller.$promise.testing.reset();
      },
    };
    Reflect.set(globalThis, Symbol.for(testHookKey), hook);
  }

  for (const user of windowUsers) await openWindow(user);
};

// `await app.whenReady()` must not run at the top level: Playwright's `_electron.launch` never
// resolves while the main module is still evaluating. A failed start must not go unnoticed.
main().catch((error: unknown) => {
  console.error('The app failed to start:', error);
  app.exit(1);
});
