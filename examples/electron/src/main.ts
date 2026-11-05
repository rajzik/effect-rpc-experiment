import { query, Router } from '@effect-trpc/core';
import { Handlers } from '@effect-trpc/server';
import { MainRpcServer } from '@effect-trpc/electron/main';
import { app, BrowserWindow, ipcMain } from 'electron';
import { Effect, Schema } from 'effect';

const router = Router.make({ ping: query({ success: Schema.String }) });
const handlers = Handlers.make(router, { ping: () => Effect.succeed('pong') });

// No top-level `await app.whenReady()`: Playwright's `_electron.launch` never resolves when the
// main module is still evaluating at the time it starts the app.
const main = async () => {
  await app.whenReady();
  const server = await MainRpcServer.run(router, { handlers, ipcMain });
  app.on('will-quit', () => void server.dispose());
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await window.loadURL('data:text/html,<title>Electron spike</title><h1>hi</h1>');
};
void main();
