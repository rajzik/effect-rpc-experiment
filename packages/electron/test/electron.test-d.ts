import type { contextBridge, IpcMainEvent, ipcMain, ipcRenderer, MessagePortMain } from 'electron';
import type { MessagePort as NodeMessagePort } from 'node:worker_threads';
import { MessageChannel as NodeMessageChannel } from 'node:worker_threads';
import type { Effect, Layer, Stream } from 'effect';
import { createClient, type Link, type RpcTransportError } from '@effect-trpc/client';
import type { Handlers } from '@effect-trpc/server';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import {
  installPreloadBridge,
  MainRpcServer,
  messagePortLink,
  rendererLink,
  type IpcMainEventLike,
  type IpcMainLike,
  type IpcRendererLike,
  type MessageChannelLike,
  type PortLike,
  type PortMainLike,
  type WindowLike,
} from '../src/index.js';
import { appRouter, makeHandlers, type AppRouter, type NotFound, type User } from './fixtures.js';

describe('structural types accept the real Electron / DOM / Node objects', () => {
  it('main process: ipcMain, IpcMainEvent, MessagePortMain', () => {
    expectTypeOf<typeof ipcMain>().toExtend<IpcMainLike>();
    expectTypeOf<IpcMainEvent>().toExtend<IpcMainEventLike>();
    expectTypeOf<MessagePortMain>().toExtend<PortMainLike>();
  });

  it('preload / renderer: ipcRenderer, window, MessagePort, MessageChannel', () => {
    expectTypeOf<typeof ipcRenderer>().toExtend<IpcRendererLike<MessagePort>>();
    expectTypeOf<Window>().toExtend<WindowLike<MessagePort>>();
    expectTypeOf<MessagePort>().toExtend<PortLike>();
    expectTypeOf<typeof MessageChannel>().toExtend<MessageChannelLike<MessagePort>>();
  });

  it('tests: Node worker_threads ports', () => {
    expectTypeOf<NodeMessagePort>().toExtend<PortLike>();
    expectTypeOf<typeof NodeMessageChannel>().toExtend<MessageChannelLike<NodeMessagePort>>();
  });

  it('the README calls type-check with the real Electron modules', () => {
    const main = (ipc: typeof ipcMain) =>
      MainRpcServer.run(appRouter, { handlers: makeHandlers().handlers, ipcMain: ipc });
    expectTypeOf(main).returns.resolves.toHaveProperty('dispose');
    const preload = (ipc: typeof ipcRenderer, bridge: typeof contextBridge) => {
      bridge.exposeInMainWorld('effectTrpcChannel', 'effect-trpc');
      return installPreloadBridge({ ipcRenderer: ipc });
    };
    expectTypeOf(preload).returns.toEqualTypeOf<() => void>();
    expectTypeOf(rendererLink()).toEqualTypeOf<Link>();
  });
});

describe('public API types', () => {
  it('links are plain client links with typed procedures', () => {
    const client = createClient(appRouter, { link: messagePortLink(new MessageChannel().port1) });
    expectTypeOf(client.user.byId).returns.toEqualTypeOf<Promise<User>>();
    expectTypeOf(client.$effect.user.byId).returns.toEqualTypeOf<
      Effect.Effect<User, NotFound | RpcTransportError>
    >();
    expectTypeOf(client.$effect.ticks).returns.toEqualTypeOf<
      Stream.Stream<number, RpcTransportError>
    >();
  });

  it('MainRpcServer.layer keeps unprovided handler requirements', () => {
    const complete = MainRpcServer.layer(appRouter, {
      handlers: makeHandlers().handlers,
      ipcMain: null as unknown as IpcMainLike,
    });
    expectTypeOf(complete).toEqualTypeOf<Layer.Layer<never, never>>();
    const missing = MainRpcServer.layer(appRouter, { ipcMain: null as unknown as IpcMainLike });
    expectTypeOf(missing).toEqualTypeOf<
      Layer.Layer<never, never, Handlers.Requirements<AppRouter>>
    >();
  });

  it('MainRpcServer.run requires a complete handlers layer', () => {
    // @ts-expect-error -- `handlers` is required
    void MainRpcServer.run(appRouter, { ipcMain: null as unknown as IpcMainLike });
    expectTypeOf(MainRpcServer.senderId).returns.toEqualTypeOf<number | undefined>();
  });
});
