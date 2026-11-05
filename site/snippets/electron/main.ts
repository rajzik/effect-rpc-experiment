// main.ts — the main process hosts the server.
import { app, BrowserWindow, ipcMain } from 'electron';
import { MainRpcServer } from '@effect-trpc/electron/main';

import { appRouter } from '@/router';
import { ServerLive } from '@/server';

await app.whenReady();

// #region run
const server = await MainRpcServer.run(appRouter, {
  handlers: ServerLive,
  ipcMain,
  // Optional: reject connections, e.g. from frames not served by your app.
  authorize: (event) => event.senderFrame?.url.startsWith('app://') === true,
});
app.on('will-quit', () => void server.dispose());
// #endregion run

await new BrowserWindow({
  webPreferences: {
    preload: `${import.meta.dirname}/preload.js`,
    contextIsolation: true, // required (Electron's default)
    sandbox: true, // fine: the bridge has no dependencies; bundle the preload
  },
}).loadFile('index.html');
