// The main-process server and the MessagePort server take a router service class: renderers get
// class instances and typed errors.
import { MessageChannel as NodeMessageChannel } from 'node:worker_threads';
import type { MessagePort } from 'node:worker_threads';
import { Effect, Exit, Layer, Scope } from 'effect';
import { createClient } from '@rpc-effect/client';
import { Router } from '@rpc-effect/core';
import { describe, expect, it, onTestFinished } from 'vite-plus/test';
import {
  installPreloadBridge,
  MainRpcServer,
  messagePortLink,
  MessagePortServer,
  rendererLink,
} from '../src/index.js';
import { FakeIpcMain, FakeWindow, makeIpcRenderer, MessageChannel } from './fakes.js';
import { drain, rejectionOf } from './helpers.js';
import { AppHandlers, AppRouter, Post, PostNotFound, postCreatedAt } from './service-fixtures.js';

describe('Electron with a router service', () => {
  it('MainRpcServer.run + rendererLink', async () => {
    const ipcMain = new FakeIpcMain();
    const server = await MainRpcServer.run(AppRouter, { handlers: AppHandlers, ipcMain });
    onTestFinished(() => server.dispose());
    const window = new FakeWindow();
    const uninstall = installPreloadBridge({ ipcRenderer: makeIpcRenderer(ipcMain, 1), window });
    onTestFinished(uninstall);
    await using client = createClient(AppRouter, {
      link: rendererLink<MessagePort>({ window, MessageChannel }),
    });
    const post = await client.post.byId({ id: 1 });
    expect(post).toBeInstanceOf(Post);
    expect(post.headline()).toBe('#1 Hello');
    expect(post.createdAt).toEqual(postCreatedAt);
    expect(await rejectionOf(client.post.byId({ id: 7 }))).toBeInstanceOf(PostNotFound);
  });

  it('MessagePortServer.serve + messagePortLink', async () => {
    const scope = Scope.makeUnsafe();
    onTestFinished(() => Effect.runPromise(Scope.close(scope, Exit.void)));
    const server = await Effect.runPromise(
      MessagePortServer.serve(AppRouter, { handlers: AppHandlers }).pipe(Scope.provide(scope)),
    );
    const { port1, port2 } = new NodeMessageChannel();
    await Effect.runPromise(server.attach(port2));
    await using client = createClient(AppRouter, { link: messagePortLink(port1) });
    expect(client.$router).toBe(Router.from(AppRouter));
    expect(await client.post.byId({ id: 1 })).toBeInstanceOf(Post);
    expect(await rejectionOf(client.post.byId({ id: 7 }))).toBeInstanceOf(PostNotFound);
    expect((await drain(client.post.titles())).values).toEqual(['first', 'second']);
  });

  it('MainRpcServer.layer and make accept the class', async () => {
    const ipcMain = new FakeIpcMain();
    const scope = Scope.makeUnsafe();
    onTestFinished(() => Effect.runPromise(Scope.close(scope, Exit.void)));
    await Effect.runPromise(
      Layer.buildWithScope(
        MainRpcServer.layer(AppRouter, { handlers: AppHandlers, ipcMain }),
        scope,
      ),
    );
    expect(ipcMain.listenerCount('effect-trpc')).toBe(1);
    await Effect.runPromise(
      MainRpcServer.make(AppRouter, { handlers: AppHandlers, ipcMain, channel: 'other' }).pipe(
        Scope.provide(scope),
      ),
    );
    expect(ipcMain.listenerCount('other')).toBe(1);
  });
});
