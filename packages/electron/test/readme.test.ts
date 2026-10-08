// The README's three-file setup, with the Electron objects replaced by the test fakes.
import type { MessagePort } from 'node:worker_threads';
import { Effect, Schema, Stream } from 'effect';
import { describe, expect, it } from 'vite-plus/test';
import { query, Router, subscription } from '@effect-trpc/core';
import { createClient } from '@effect-trpc/client';
import { Handlers } from '@effect-trpc/server';
import { MainRpcServer } from '../src/main.js';
import { installPreloadBridge } from '../src/preload.js';
import { rendererLink } from '../src/renderer.js';
import { FakeIpcMain, FakeWindow, makeIpcRenderer, MessageChannel } from './fakes.js';
import { rejectionOf } from './helpers.js';

// shared/router.ts
class User extends Schema.Class<User>('User')({ id: Schema.String, name: Schema.String }) {}
class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { id: Schema.String }) {}

const appRouter = Router.make({
  user: { byId: query({ payload: { id: Schema.String }, success: User, error: NotFound }) },
  clock: subscription({ success: Schema.Number }),
  whoami: query({ success: Schema.NullOr(Schema.Number) }),
});

describe('README', () => {
  it('main.ts + preload.ts + renderer.tsx', async () => {
    const ipcMain = new FakeIpcMain();
    const window = new FakeWindow();
    const ipcRenderer = makeIpcRenderer(ipcMain, 3);

    // main.ts
    const HandlersLive = Handlers.make(appRouter, {
      user: {
        byId: ({ id }) =>
          id === '1'
            ? Effect.succeed(new User({ id, name: 'Ada' }))
            : Effect.fail(new NotFound({ id })),
      },
      clock: () => Stream.make(1, 2, 3),
      whoami: (_, { headers }) => Effect.succeed(MainRpcServer.senderId(headers) ?? null),
    });
    const server = await MainRpcServer.run(appRouter, { handlers: HandlersLive, ipcMain });

    // preload.ts
    const uninstall = installPreloadBridge({ ipcRenderer, window });

    // renderer.tsx
    const client = createClient(appRouter, {
      link: rendererLink<MessagePort>({ window, MessageChannel }),
    });

    const user = await client.user.byId({ id: '1' });
    expect(user).toBeInstanceOf(User);
    expect(await rejectionOf(client.user.byId({ id: '2' }))).toBeInstanceOf(NotFound);
    const ticks: Array<number> = [];
    for await (const now of client.clock()) ticks.push(now);
    expect(ticks).toEqual([1, 2, 3]);
    await expect(client.whoami()).resolves.toBe(3);

    await client.dispose();
    uninstall();
    await server.dispose();
  });
});
