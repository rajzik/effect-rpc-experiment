import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { describe, expect, it } from 'vite-plus/test';
import { connectMessageType, installPreloadBridge, type IpcRendererLike } from '../src/preload.js';
import { FakeWindow, tick } from './fakes.js';

const recorder = () => {
  const calls: Array<{ channel: string; message: unknown; ports: number }> = [];
  const ipcRenderer: IpcRendererLike<MessagePort> = {
    postMessage: (channel, message, transfer = []) =>
      calls.push({ channel, message, ports: transfer.length }),
  };
  return { calls, ipcRenderer };
};

describe('installPreloadBridge', () => {
  it('forwards only handshake messages from its own window on its channel', async () => {
    const window = new FakeWindow();
    const { calls, ipcRenderer } = recorder();
    const uninstall = installPreloadBridge({ ipcRenderer, window });
    const port = () => new MessageChannel().port2;
    const connect = { type: connectMessageType, channel: 'effect-trpc' };
    window.postMessage(connect, '*', [port()]);
    window.postMessage({ type: connectMessageType, channel: 'other' }, '*', [port()]);
    window.postMessage({ type: 'something-else', channel: 'effect-trpc' }, '*', [port()]);
    window.postMessage(connect, '*', []);
    window.postMessage(connect, '*', [port(), port()]);
    window.dispatch({ data: connect, ports: [port()], source: { iframe: true } });
    await tick();
    expect(calls).toEqual([
      { channel: 'effect-trpc', message: { type: connectMessageType }, ports: 1 },
    ]);
    uninstall();
    expect(window.listenerCount).toBe(0);
  });

  it('defaults to globalThis.window and fails clearly without one', () => {
    const { ipcRenderer } = recorder();
    expect(() => installPreloadBridge({ ipcRenderer })).toThrow(/no window/);
  });
});
