import { connectMessageType, defaultChannel } from './types.js';
import type { IpcRendererLike, PortLike, WindowLike, WindowMessageEventLike } from './types.js';

/** Options of {@link installPreloadBridge}. */
export interface PreloadBridgeOptions<Port = PortLike> {
  /** Electron's `ipcRenderer`. */
  readonly ipcRenderer: IpcRendererLike<Port>;
  /** The window to listen on. Defaults to `globalThis.window`. */
  readonly window?: WindowLike<Port> | undefined;
  /** The IPC channel (must match `MainRpcServer` and `rendererLink`). Defaults to `"effect-trpc"`. */
  readonly channel?: string | undefined;
}

/** The handshake message the renderer posts to its own window (see `rendererLink`). */
export interface ConnectMessage {
  readonly type: typeof connectMessageType;
  readonly channel: string;
}

const isConnectMessage = (data: unknown, channel: string): data is ConnectMessage =>
  typeof data === 'object' &&
  data !== null &&
  (data as Partial<ConnectMessage>).type === connectMessageType &&
  (data as Partial<ConnectMessage>).channel === channel;

/**
 * Call once in the preload script (`contextIsolation: true`, sandbox friendly: no Effect, no
 * Node APIs). Forwards the `MessagePort` that `rendererLink` posts to the page's own window to
 * the main process via `ipcRenderer.postMessage(channel, ..., [port])`. Only messages whose
 * `source` is this window (not an iframe) and whose `channel` matches are forwarded.
 * Returns a function that removes the listener.
 */
export const installPreloadBridge = <Port = PortLike>(
  options: PreloadBridgeOptions<Port>,
): (() => void) => {
  const channel = options.channel ?? defaultChannel;
  const target =
    options.window ?? (globalThis as { readonly window?: WindowLike<Port> | undefined }).window;
  if (target === undefined) {
    throw new Error('installPreloadBridge: no window (pass `window` outside a renderer)');
  }
  const { ipcRenderer } = options;
  const listener = (event: WindowMessageEventLike<Port>): void => {
    if (event.source !== undefined && event.source !== null && event.source !== target) return;
    if (!isConnectMessage(event.data, channel)) return;
    const port = event.ports[0];
    if (port === undefined || event.ports.length !== 1) return;
    ipcRenderer.postMessage(channel, { type: connectMessageType }, [port]);
  };
  target.addEventListener('message', listener);
  return () => target.removeEventListener('message', listener);
};
