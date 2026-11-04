/**
 * Main-process entry (`@effect-trpc/electron/main`): serves a router to renderers.
 *
 * Exports `MainRpcServer` (listens on `ipcMain` for ports forwarded by the preload bridge),
 * the generic `MessagePortServer` and the structural port / IPC types. Import it only in
 * Electron's main process (or a Node process serving worker threads).
 *
 * @since 0.1.0
 */
export {
  MainRpcServer,
  senderIdHeader,
  type MainRpcServerOptions,
  type MainRpcServerRunOptions,
  type RunningMainRpcServer,
} from './MainRpcServer.js';
export {
  MessagePortServer,
  type AttachOptions,
  type MessagePortServerOptions,
  type ServeOptions,
} from './MessagePortServer.js';
export {
  defaultChannel,
  type Frame,
  type AnyPort,
  type IpcMainEventLike,
  type IpcMainLike,
  type IpcMainListener,
  type MessageEventLike,
  type PortListener,
  type PortLike,
  type PortMainLike,
} from './types.js';
