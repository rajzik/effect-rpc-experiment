import { EventEmitter } from 'node:events';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import type {
  IpcMainEventLike,
  IpcMainLike,
  IpcMainListener,
  IpcRendererLike,
  PortMainLike,
  WindowLike,
  WindowMessageEventLike,
} from '../src/index.js';

/**
 * An Electron `MessagePortMain` look-alike over a Node port: EventEmitter API, `message` events
 * carry `{ data, ports }`, and messages are queued until `start()` (like Electron).
 */
export class FakePortMain extends EventEmitter implements PortMainLike {
  private started = false;
  constructor(readonly port: MessagePort) {
    super();
  }
  postMessage(message: string): void {
    this.port.postMessage(message);
  }
  start(): void {
    if (this.started) return;
    this.started = true;
    this.port.on('message', (data: unknown) => this.emit('message', { data, ports: [] }));
    this.port.on('close', () => this.emit('close'));
  }
  close(): void {
    this.port.close();
  }
}

/** An `ipcMain` look-alike that records the connections it handed out. */
export class FakeIpcMain extends EventEmitter implements IpcMainLike {
  readonly connections: Array<FakePortMain> = [];
  override on(channel: string, listener: IpcMainListener): this {
    return super.on(channel, listener);
  }
  override removeListener(channel: string, listener: IpcMainListener): this {
    return super.removeListener(channel, listener);
  }
  /** Delivers an `ipcRenderer.postMessage` (asynchronously, like real IPC). */
  deliver(channel: string, event: IpcMainEventLike, message: unknown): void {
    setImmediate(() => this.emit(channel, event, message));
  }
}

/** An `ipcRenderer` look-alike bound to one renderer (`webContents.id = senderId`). */
export const makeIpcRenderer = (
  ipcMain: FakeIpcMain,
  senderId: number,
  url = 'app://index.html',
): IpcRendererLike<MessagePort> => ({
  postMessage: (channel, message, transfer = []) => {
    const ports = transfer.map((port) => new FakePortMain(port));
    ipcMain.connections.push(...ports);
    ipcMain.deliver(channel, { ports, sender: { id: senderId }, senderFrame: { url } }, message);
  },
});

/** A `window` look-alike: `postMessage` dispatches a `message` event (asynchronously). */
export class FakeWindow implements WindowLike<MessagePort> {
  private readonly listeners = new Set<(event: WindowMessageEventLike<MessagePort>) => void>();
  get listenerCount(): number {
    return this.listeners.size;
  }
  postMessage(message: unknown, _targetOrigin: string, transfer: Array<MessagePort> = []): void {
    this.dispatch({ data: message, ports: transfer, source: this });
  }
  /** Dispatches an arbitrary event (e.g. one coming from an iframe). */
  dispatch(event: WindowMessageEventLike<MessagePort>): void {
    setImmediate(() => {
      for (const listener of this.listeners) listener(event);
    });
  }
  addEventListener(
    _type: 'message',
    listener: (event: WindowMessageEventLike<MessagePort>) => void,
  ): void {
    this.listeners.add(listener);
  }
  removeEventListener(
    _type: 'message',
    listener: (event: WindowMessageEventLike<MessagePort>) => void,
  ): void {
    this.listeners.delete(listener);
  }
}

export { MessageChannel };

/** Number of open Node `MessagePort` handles (to detect leaks). */
export const openPorts = (): number =>
  process.getActiveResourcesInfo().filter((name) => name === 'MessagePort').length;

/** Resolves after pending I/O callbacks ran. */
export const tick = (ms = 10): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
