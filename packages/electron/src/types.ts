/**
 * Structural views of the Electron, DOM and Node objects the Electron transport talks to.
 *
 * `@effect-trpc/electron` never imports `electron` at runtime. Its public functions accept these
 * minimal interfaces instead, which Electron's real `ipcMain`, `IpcMainEvent`, `ipcRenderer`,
 * `MessagePortMain`, DOM `MessagePort` / `window` / `MessageChannel` and Node's
 * `worker_threads` ports all satisfy (proven by `test/electron.test-d.ts`). This keeps the
 * preload bundle tiny and lets the tests drive the whole stack in plain Node.
 *
 * @since 0.1.0
 */

/**
 * The default IPC channel (`"effect-trpc"`) on which the preload bridge hands a renderer's
 * `MessagePort` to the main process.
 *
 * **When to use**
 *
 * You rarely need it: `MainRpcServer`, `installPreloadBridge` and `rendererLink` all default to
 * it. Read it when you write a custom preload bridge or want to inspect the `ipcMain` listener.
 *
 * **Details**
 *
 * - The channel name is also part of the renderer → preload handshake message
 *   ({@link connectMessageType}), so a renderer and a bridge on different channels ignore each
 *   other.
 *
 * **Gotchas**
 *
 * - Passing a custom `channel` to one side only makes the renderer's calls fail with
 *   `RpcTransportError` after `connectTimeout`. Pass the same `channel` to all three sides.
 *
 * **Example** (Checking that the main-process server is listening)
 *
 * ```ts
 * // main.ts (main process)
 * import { ipcMain } from 'electron';
 * import { defaultChannel } from '@effect-trpc/electron/main';
 *
 * // 1 while a `MainRpcServer` runs on the default channel, 0 after `server.dispose()`.
 * console.log(ipcMain.listenerCount(defaultChannel));
 * ```
 *
 * @see {@link connectMessageType}
 * @category utils
 * @since 0.1.0
 */
export const defaultChannel = 'effect-trpc' as const;

/**
 * The `type` (`"effect-trpc/connect"`) of the handshake message the renderer posts to its own
 * window, and of the IPC message the preload bridge sends to the main process.
 *
 * **When to use**
 *
 * Use it only when you replace `installPreloadBridge` with your own preload code (for example to
 * add an origin check before forwarding the port).
 *
 * **Details**
 *
 * - `rendererLink` posts `{ type: connectMessageType, channel }` with one transferred port via
 *   `window.postMessage(message, '*', [port])`.
 * - The bridge forwards the port with `ipcRenderer.postMessage(channel, { type:
 *   connectMessageType }, [port])`. `MainRpcServer` only reads the transferred port, not the
 *   message body.
 *
 * **Example** (A custom preload bridge with an origin check)
 *
 * ```ts
 * // preload.ts (preload script, isolated world): what `installPreloadBridge` does, plus an
 * // origin check. Prefer `installPreloadBridge` unless you need the extra rule.
 * import { ipcRenderer } from 'electron';
 * import { connectMessageType, defaultChannel } from '@effect-trpc/electron/preload';
 *
 * window.addEventListener('message', (event) => {
 *   if (event.source !== window || location.protocol !== 'app:') return;
 *   const data: unknown = event.data;
 *   if (typeof data !== 'object' || data === null) return;
 *   const { type, channel } = data as { readonly type?: unknown; readonly channel?: unknown };
 *   const port = event.ports[0];
 *   if (type !== connectMessageType || channel !== defaultChannel || port === undefined) return;
 *   ipcRenderer.postMessage(defaultChannel, { type: connectMessageType }, [port]);
 * });
 * ```
 *
 * @see {@link defaultChannel}
 * @category utils
 * @since 0.1.0
 */
export const connectMessageType = 'effect-trpc/connect' as const;

/**
 * A protocol frame: a string for JSON serializations, bytes for binary ones.
 *
 * **Details**
 *
 * - Every `RpcSerialization` message batch is encoded into exactly one frame and posted with
 *   `port.postMessage(frame)`. Client and server must use the same serialization.
 *
 * @category models
 * @since 0.1.0
 */
export type Frame = string | Uint8Array;

/**
 * A `message` event: only `data` is read.
 *
 * @category models
 * @since 0.1.0
 */
export interface MessageEventLike {
  readonly data: unknown;
}

/**
 * A port event listener. The event is typed `unknown` so that DOM and Node ports (whose
 * `addEventListener` accepts any `EventListener`) fit; `message` listeners receive a
 * {@link MessageEventLike}.
 *
 * @category models
 * @since 0.1.0
 */
export type PortListener = (event: unknown) => void;

/**
 * A Web-style message port (DOM `MessagePort` in the renderer, Node `worker_threads`
 * `MessagePort`): `addEventListener("message" | "close")`, `postMessage`, `start`, `close`.
 *
 * **When to use**
 *
 * The port type of the client side (`messagePortLink`, `rendererLink`). The server side also
 * accepts it (see {@link AnyPort}).
 *
 * **Gotchas**
 *
 * - Electron's main-process `MessagePortMain` is EventEmitter-style and is a
 *   {@link PortMainLike}, not a `PortLike`, so it cannot back a client link.
 *
 * @see {@link PortMainLike}
 * @category models
 * @since 0.1.0
 */
export interface PortLike {
  postMessage(message: Frame): void;
  /** `message` listeners receive a {@link MessageEventLike}; `close` listeners no argument. */
  addEventListener(type: 'message' | 'close', listener: PortListener): void;
  removeEventListener(type: 'message' | 'close', listener: PortListener): void;
  start(): void;
  close(): void;
}

/**
 * An EventEmitter-style message port (Electron's `MessagePortMain` in the main process):
 * `on("message" | "close")`, `removeListener`, `postMessage`, `start`, `close`.
 *
 * **Details**
 *
 * - Electron emits `close` on a `MessagePortMain` when its remote end disconnects (the renderer
 *   called `client.dispose()`, reloaded or was destroyed); the server then interrupts that
 *   connection's handlers.
 *
 * @see {@link PortLike}
 * @category models
 * @since 0.1.0
 */
export interface PortMainLike {
  postMessage(message: Frame): void;
  on(event: 'message', listener: (event: MessageEventLike) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  removeListener(event: 'message', listener: (event: MessageEventLike) => void): unknown;
  removeListener(event: 'close', listener: () => void): unknown;
  start(): void;
  close(): void;
}

/**
 * Any port the server side (`MessagePortServer.attach`, `MainRpcServer`) accepts: Web-style or
 * EventEmitter-style.
 *
 * @category models
 * @since 0.1.0
 */
export type AnyPort = PortLike | PortMainLike;

/**
 * The part of Electron's `IpcMainEvent` the main-process server reads.
 *
 * **When to use**
 *
 * The argument of `MainRpcServerOptions.authorize`: decide from `senderFrame.url` (or
 * `sender.id`) whether a renderer may connect.
 *
 * @category models
 * @since 0.1.0
 */
export interface IpcMainEventLike {
  /** The transferred ports (`ipcRenderer.postMessage(channel, message, [port])`). */
  readonly ports: ReadonlyArray<AnyPort>;
  /** The renderer that sent the event (`WebContents`); its `id` becomes the sender id. */
  readonly sender?: { readonly id: number } | undefined;
  /** The frame that sent the event (`WebFrameMain`), e.g. to check `senderFrame.url`. */
  readonly senderFrame?: { readonly url: string } | null | undefined;
}

/**
 * A listener registered on `ipcMain`. `any[]` mirrors Electron's own listener signature
 * (`...args: any[]`).
 *
 * @category models
 * @since 0.1.0
 */
export type IpcMainListener = (
  event: IpcMainEventLike,
  // oxlint-disable-next-line typescript/no-explicit-any
  ...args: Array<any>
) => void;

/**
 * The part of Electron's `ipcMain` the main-process server uses (`on`, `removeListener`).
 *
 * @category models
 * @since 0.1.0
 */
export interface IpcMainLike {
  on(channel: string, listener: IpcMainListener): unknown;
  removeListener(channel: string, listener: IpcMainListener): unknown;
}

/**
 * The part of Electron's `ipcRenderer` the preload bridge uses. `Port` is the transferable port
 * type (DOM `MessagePort` in a real preload script).
 *
 * @category models
 * @since 0.1.0
 */
export interface IpcRendererLike<Port = PortLike> {
  postMessage(channel: string, message: unknown, transfer?: Array<Port>): void;
}

/**
 * A `message` event received by `window` (the handshake from the renderer). `source` is
 * compared with the window itself so that messages from iframes are ignored.
 *
 * @category models
 * @since 0.1.0
 */
export interface WindowMessageEventLike<Port = PortLike> extends MessageEventLike {
  readonly ports: ReadonlyArray<Port>;
  readonly source?: unknown;
}

/**
 * The part of `window` the preload bridge and the renderer link use. `Port` is the transferable
 * port type (DOM `MessagePort` in a real renderer).
 *
 * @category models
 * @since 0.1.0
 */
export interface WindowLike<Port = PortLike> {
  postMessage(message: unknown, targetOrigin: string, transfer?: Array<Port>): void;
  addEventListener(type: 'message', listener: (event: WindowMessageEventLike<Port>) => void): void;
  removeEventListener(
    type: 'message',
    listener: (event: WindowMessageEventLike<Port>) => void,
  ): void;
}

/**
 * A `MessageChannel` constructor (DOM or Node `worker_threads`): `port1` stays in the renderer,
 * `port2` is transferred to the main process.
 *
 * @category models
 * @since 0.1.0
 */
export type MessageChannelLike<Port = PortLike> = new () => {
  readonly port1: PortLike;
  readonly port2: Port;
};
