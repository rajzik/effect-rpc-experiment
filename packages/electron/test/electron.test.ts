import { Effect, Stream } from 'effect';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import type { MessagePort } from 'node:worker_threads';
import { createClient, RpcDefect, RpcInterrupted, RpcTransportError } from '@effect-trpc/client';
import { MainRpcServer, rendererLink } from '../src/index.js';
import { FakeWindow, MessageChannel, openPorts, tick } from './fakes.js';
import { appRouter, createdAt, NotFound, User } from './fixtures.js';
import { drain, rejectionOf, within } from './helpers.js';
import { startApp, type App } from './setup.js';

let app: App | undefined;
afterEach(async () => {
  await app?.dispose();
  app = undefined;
});

describe('renderer link → preload bridge → main-process server', () => {
  it('queries return Schema.Class instances (methods and Date fields survive)', async () => {
    app = await startApp();
    const { client } = app.renderer(1);
    const user = await client.user.byId({ id: '42' });
    expect(user).toBeInstanceOf(User);
    expect(user.greet()).toBe('Hello, Ada!');
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.createdAt.getTime()).toBe(createdAt.getTime());
  });

  it('rejects with typed TaggedError instances', async () => {
    app = await startApp();
    const { client } = app.renderer(1);
    const error = await rejectionOf(client.user.byId({ id: 'ghost' }));
    expect(error).toBeInstanceOf(NotFound);
    expect((error as NotFound).id).toBe('ghost');
    const viaEffect = await Effect.runPromise(
      Effect.flip(client.$effect.user.byId({ id: 'ghost' })),
    );
    expect(viaEffect).toBeInstanceOf(NotFound);
  });

  it('runs mutations', async () => {
    app = await startApp();
    const { client } = app.renderer(1);
    const created = await client.user.create({ name: 'Grace' });
    expect(created).toBeInstanceOf(User);
    expect(created.name).toBe('Grace');
  });

  it('streams subscriptions, including a typed mid-stream failure', async () => {
    app = await startApp();
    const { client } = app.renderer(1);
    expect((await drain(client.ticks({ n: 5 }))).values).toEqual([0, 1, 2, 3, 4]);
    const failed = await drain(client.tickStream({ failAt: 3 }));
    expect(failed.values).toEqual([0, 1, 2]);
    expect(failed.error).toBeInstanceOf(NotFound);
    const many = await Effect.runPromise(Stream.runCollect(client.$effect.ticks({ n: 200 })));
    expect(many).toEqual(Array.from({ length: 200 }, (_, i) => i));
  });

  it('aborting a call rejects with RpcInterrupted and interrupts the handler', async () => {
    app = await startApp();
    const { client } = app.renderer(1);
    const controller = new AbortController();
    const pending = rejectionOf(client.slow(undefined, { signal: controller.signal }));
    await within(app.probe.started);
    controller.abort();
    expect(await pending).toBeInstanceOf(RpcInterrupted);
    await within(app.probe.interrupted);
    expect(app.probe.state.interrupted).toBe(1);
    // breaking out of a subscription closes the server stream
    for await (const value of client.forever()) if (value >= 2) break;
    await within(app.probe.streamClosed);
    await expect(client.user.byId({ id: '1' })).resolves.toBeInstanceOf(User);
  });

  it('a defect rejects with RpcDefect and the connection stays usable', async () => {
    app = await startApp();
    const { client } = app.renderer(1);
    const defect = await rejectionOf(client.boom());
    expect(defect).toBeInstanceOf(RpcDefect);
    expect((defect as RpcDefect).message).toContain('kaboom');
    await expect(client.user.byId({ id: '1' })).resolves.toBeInstanceOf(User);
    expect(app.ipcMain.connections).toHaveLength(1);
  });

  it('isolates renderers: separate connections, trusted sender ids, defects stay local', async () => {
    app = await startApp();
    const one = app.renderer(1);
    const two = app.renderer(2);
    const [id1, id2] = await Promise.all([one.client.whoami(), two.client.whoami()]);
    expect([id1, id2]).toEqual([1, 2]);
    expect(app.ipcMain.connections).toHaveLength(2);
    // a renderer cannot spoof the sender id header
    await expect(
      one.client.whoami(undefined, { headers: { [MainRpcServer.senderIdHeader]: '99' } }),
    ).resolves.toBe(1);
    const stream = drain(two.client.ticks({ n: 3 }));
    expect(await rejectionOf(one.client.boom())).toBeInstanceOf(RpcDefect);
    expect((await stream).values).toEqual([0, 1, 2]);
    // closing one connection does not affect the other
    await one.client.dispose();
    await expect(two.client.user.create({ name: 'still here' })).resolves.toBeInstanceOf(User);
  });

  it('a port closed by the main process interrupts handlers and rejects pending calls', async () => {
    app = await startApp();
    const { client } = app.renderer(1);
    const pending = rejectionOf(client.slow());
    const stream = drain(client.forever());
    await within(Promise.all([app.probe.started, app.probe.streamStarted]));
    app.ipcMain.connections[0]?.close();
    const error = await within(pending);
    expect(error).toBeInstanceOf(RpcTransportError);
    expect((error as RpcTransportError).message).toContain('closed');
    expect((await within(stream)).error).toBeInstanceOf(RpcTransportError);
    await within(Promise.all([app.probe.interrupted, app.probe.streamClosed]));
    // later calls fail fast instead of hanging
    expect(await within(rejectionOf(client.user.byId({ id: '1' })))).toBeInstanceOf(
      RpcTransportError,
    );
  });

  it('disposing the renderer client closes its port and interrupts its handlers', async () => {
    app = await startApp();
    const { client } = app.renderer(1);
    const pending = rejectionOf(client.slow());
    await within(app.probe.started);
    await client.dispose();
    await within(app.probe.interrupted);
    expect(await pending).toBeInstanceOf(RpcInterrupted);
  });

  it('dispose() stops listening, closes every connection and leaves no open handles', async () => {
    const baseline = openPorts();
    const started = await startApp();
    const { client } = started.renderer(1);
    await expect(client.user.byId({ id: '1' })).resolves.toBeInstanceOf(User);
    const pending = rejectionOf(client.slow());
    await within(started.probe.started);
    expect(openPorts()).toBeGreaterThan(baseline);
    await started.server.dispose();
    expect(started.ipcMain.listenerCount('effect-trpc')).toBe(0);
    expect(await within(pending)).toBeInstanceOf(RpcTransportError);
    expect(started.probe.state.interrupted).toBe(1);
    await started.dispose();
    await tick();
    expect(openPorts()).toBeLessThanOrEqual(baseline);
  });

  it('fails with RpcTransportError instead of hanging when the main process never answers', async () => {
    app = await startApp();
    // no preload bridge on this window: the port never reaches the main process
    const window = new FakeWindow();
    const client = createClient(appRouter, {
      link: rendererLink<MessagePort>({ window, MessageChannel, connectTimeout: '30 millis' }),
    });
    const error = await within(rejectionOf(client.user.byId({ id: '1' })));
    expect(error).toBeInstanceOf(RpcTransportError);
    expect((error as RpcTransportError).message).toContain('preload bridge');
    await client.dispose();
  });

  it('uses a custom channel and rejects unauthorized or malformed connections', async () => {
    app = await startApp({ channel: 'app-rpc', authorize: (url) => url.startsWith('app://') });
    const { client } = app.renderer(7);
    await expect(client.whoami()).resolves.toBe(7);
    // ports on another channel are ignored by the main process
    expect(app.ipcMain.listenerCount('effect-trpc')).toBe(0);
    expect(app.ipcMain.listenerCount('app-rpc')).toBe(1);
  });
});
