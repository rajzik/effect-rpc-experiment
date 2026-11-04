/**
 * Typed effect-trpc RPC between Electron's main process and its renderers, over one
 * `MessagePort` per renderer client.
 *
 * This root entry re-exports everything for tests and tooling. Apps should import the
 * process-specific entries instead: `@effect-trpc/electron/main` (main process),
 * `@effect-trpc/electron/preload` (preload script, no Effect) and
 * `@effect-trpc/electron/renderer` (renderer). Routers come from `@effect-trpc/core`, handlers
 * from `@effect-trpc/server` and clients from `@effect-trpc/client`.
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
  messagePortLink,
  messagePortProtocolClient,
  type MessagePortLinkOptions,
  type PortSource,
} from './MessagePortLink.js';
export {
  installPreloadBridge,
  type ConnectMessage,
  type PreloadBridgeOptions,
} from './PreloadBridge.js';
export { rendererLink, type RendererLinkOptions } from './RendererLink.js';
export {
  connectMessageType,
  defaultChannel,
  type Frame,
  type AnyPort,
  type IpcMainEventLike,
  type IpcMainLike,
  type IpcMainListener,
  type IpcRendererLike,
  type MessageChannelLike,
  type MessageEventLike,
  type PortListener,
  type PortLike,
  type PortMainLike,
  type WindowLike,
  type WindowMessageEventLike,
} from './types.js';
