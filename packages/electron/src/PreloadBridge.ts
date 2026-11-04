/**
 * The preload-script half of the Electron transport: forwards renderer ports to the main process.
 *
 * `installPreloadBridge` runs in the preload's isolated world. It relays the `MessagePort` that
 * `rendererLink` posts to the page's own window to `MainRpcServer` via `ipcRenderer`. It uses no
 * Effect and no Node APIs, so it fits a small sandboxed preload bundle.
 *
 * @since 0.1.0
 */
import { connectMessageType, defaultChannel } from './types.js';
import type { IpcRendererLike, PortLike, WindowLike, WindowMessageEventLike } from './types.js';

/**
 * Options of {@link installPreloadBridge}.
 *
 * @category options
 * @since 0.1.0
 */
export interface PreloadBridgeOptions<Port = PortLike> {
  /** Electron's `ipcRenderer`. */
  readonly ipcRenderer: IpcRendererLike<Port>;
  /** The window to listen on. Defaults to `globalThis.window`. */
  readonly window?: WindowLike<Port> | undefined;
  /** The IPC channel (must match `MainRpcServer` and `rendererLink`). Defaults to `"effect-trpc"`. */
  readonly channel?: string | undefined;
}

/**
 * The handshake message the renderer posts to its own window (see `rendererLink`), with exactly
 * one transferred port.
 *
 * @category models
 * @since 0.1.0
 */
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
 *
 * **When to use**
 *
 * In the preload script of every `BrowserWindow` whose page uses `rendererLink`. It is the only
 * code from this package that runs there.
 *
 * **Details**
 *
 * - Forwards a message only when its `type` is `"effect-trpc/connect"`, its `channel` matches
 *   and it carries exactly one port. Everything else is ignored.
 * - The listener stays installed until the returned function is called, so every client the
 *   page creates is forwarded. A page reload re-runs the preload script, which installs a fresh
 *   bridge.
 * - Throws synchronously when there is no `window` (pass `window` outside a renderer).
 *
 * **Gotchas**
 *
 * - No `contextBridge.exposeInMainWorld` is needed: the page never sees `ipcRenderer`; it only
 *   posts a port to its own window. Keep `contextIsolation: true`.
 * - With `sandbox: true` the preload cannot `require` npm packages: bundle it. Import only
 *   `@effect-trpc/electron/preload` there, never `/main` or the root entry.
 * - Any script in the page (not iframes) can hand a port to the bridge. Authorize in the main
 *   process (`authorize`, handlers, middleware), not here.
 *
 * **Example** (The whole preload script)
 *
 * ```ts
 * // preload.ts (preload script, isolated world; bundled when `sandbox: true`)
 * import { ipcRenderer } from 'electron';
 * import { installPreloadBridge } from '@effect-trpc/electron/preload';
 *
 * installPreloadBridge({ ipcRenderer });
 * ```
 *
 * **Example** (Two independent servers on custom channels)
 *
 * ```ts
 * // preload.ts (preload script): one bridge per channel; the main process runs one
 * // `MainRpcServer` per channel and the renderer passes the same `channel` to `rendererLink`.
 * import { ipcRenderer } from 'electron';
 * import { installPreloadBridge } from '@effect-trpc/electron/preload';
 *
 * installPreloadBridge({ ipcRenderer, channel: 'app-rpc' });
 * installPreloadBridge({ ipcRenderer, channel: 'admin-rpc' });
 * ```
 *
 * @see {@link ConnectMessage}
 * @category adapters
 * @since 0.1.0
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
