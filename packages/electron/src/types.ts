// Minimal structural views of the Electron / DOM / Node objects this package talks to. They are
// satisfied by Electron's real `ipcMain`, `ipcRenderer`, `MessagePortMain` and DOM `MessagePort`
// / `window`, and by Node's `worker_threads` `MessageChannel` ports (used by the tests). The
// package never imports `electron` at runtime.

/** The default IPC channel used to hand a `MessagePort` from the renderer to the main process. */
export const defaultChannel = 'effect-trpc' as const;

/** The `type` of the `window.postMessage` handshake message (renderer → preload). */
export const connectMessageType = 'effect-trpc/connect' as const;

/** A protocol frame: a string for the JSON serializations, bytes for binary ones. */
export type Frame = string | Uint8Array;

/** A `message` event: only `data` is read. */
export interface MessageEventLike {
  readonly data: unknown;
}

/**
 * A port event listener. The event is typed `unknown` so that DOM and Node ports (whose
 * `addEventListener` accepts any `EventListener`) fit; `message` listeners receive a
 * {@link MessageEventLike}.
 */
export type PortListener = (event: unknown) => void;

/**
 * A Web-style message port (DOM `MessagePort` in the renderer, Node `worker_threads`
 * `MessagePort`): `addEventListener("message" | "close")`, `postMessage`, `start`, `close`.
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

/** Any port the main-process server accepts. */
export type AnyPort = PortLike | PortMainLike;

/** The part of Electron's `IpcMainEvent` the main-process server reads. */
export interface IpcMainEventLike {
  /** The transferred ports (`ipcRenderer.postMessage(channel, message, [port])`). */
  readonly ports: ReadonlyArray<AnyPort>;
  /** The renderer that sent the event (`WebContents`); its `id` becomes the sender id. */
  readonly sender?: { readonly id: number } | undefined;
  /** The frame that sent the event (`WebFrameMain`), e.g. to check `senderFrame.url`. */
  readonly senderFrame?: { readonly url: string } | null | undefined;
}

/** A listener registered on `ipcMain`. */
// `any[]` mirrors Electron's own listener signature (`...args: any[]`).
// oxlint-disable-next-line typescript/no-explicit-any
export type IpcMainListener = (event: IpcMainEventLike, ...args: Array<any>) => void;

/** The part of Electron's `ipcMain` the main-process server uses. */
export interface IpcMainLike {
  on(channel: string, listener: IpcMainListener): unknown;
  removeListener(channel: string, listener: IpcMainListener): unknown;
}

/**
 * The part of Electron's `ipcRenderer` the preload bridge uses. `Port` is the transferable port
 * type (DOM `MessagePort` in a real preload script).
 */
export interface IpcRendererLike<Port = PortLike> {
  postMessage(channel: string, message: unknown, transfer?: Array<Port>): void;
}

/** A `message` event received by `window` (the handshake from the renderer). */
export interface WindowMessageEventLike<Port = PortLike> extends MessageEventLike {
  readonly ports: ReadonlyArray<Port>;
  readonly source?: unknown;
}

/**
 * The part of `window` the preload bridge and the renderer link use. `Port` is the transferable
 * port type (DOM `MessagePort` in a real renderer).
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
 */
export type MessageChannelLike<Port = PortLike> = new () => {
  readonly port1: PortLike;
  readonly port2: Port;
};
