import type { MessagePort } from 'node:worker_threads';
import { createClient, type Client } from '@effect-trpc/client';
import {
  installPreloadBridge,
  MainRpcServer,
  rendererLink,
  type RunningMainRpcServer,
} from '../src/index.js';
import { FakeIpcMain, FakeWindow, makeIpcRenderer, MessageChannel } from './fakes.js';
import { appRouter, makeHandlers, type AppRouter, type Probe } from './fixtures.js';

/** One renderer process: its window, the installed preload bridge and a client. */
export interface Renderer {
  readonly window: FakeWindow;
  readonly client: Client<AppRouter>;
  readonly uninstall: () => void;
}

export interface App {
  readonly ipcMain: FakeIpcMain;
  readonly server: RunningMainRpcServer;
  readonly probe: Probe;
  readonly renderer: (senderId: number, channel?: string) => Renderer;
  readonly dispose: () => Promise<void>;
}

/** Main process (`MainRpcServer.run`) + any number of renderers with preload bridges. */
export const startApp = async (
  options: { readonly channel?: string; readonly authorize?: (url: string) => boolean } = {},
): Promise<App> => {
  const ipcMain = new FakeIpcMain();
  const { handlers, probe } = makeHandlers();
  const { authorize } = options;
  const server = await MainRpcServer.run(appRouter, {
    handlers,
    ipcMain,
    channel: options.channel,
    authorize:
      authorize === undefined ? undefined : (event) => authorize(event.senderFrame?.url ?? ''),
  });
  const renderers: Array<Renderer> = [];
  const renderer = (senderId: number, channel = options.channel): Renderer => {
    const window = new FakeWindow();
    const uninstall = installPreloadBridge({
      ipcRenderer: makeIpcRenderer(ipcMain, senderId),
      window,
      channel,
    });
    const client = createClient(appRouter, {
      link: rendererLink<MessagePort>({ window, MessageChannel, channel }),
    });
    const created = { window, client, uninstall };
    renderers.push(created);
    return created;
  };
  const dispose = async (): Promise<void> => {
    for (const r of renderers) {
      await r.client.dispose();
      r.uninstall();
    }
    await server.dispose();
  };
  return { ipcMain, server, probe, renderer, dispose };
};
