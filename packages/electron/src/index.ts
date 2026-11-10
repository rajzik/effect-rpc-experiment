/**
 * Typed effect-trpc RPC between Electron's main process and its renderers, over one
 * `MessagePort` per renderer client.
 *
 * This root entry re-exports everything for tests and tooling. Apps should import the
 * process-specific entries instead: `@rpc-effect/electron/main` (main process),
 * `@rpc-effect/electron/preload` (preload script, no Effect) and
 * `@rpc-effect/electron/renderer` (renderer). Routers come from `@rpc-effect/core`, handlers
 * from `@rpc-effect/server` and clients from `@rpc-effect/client`.
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
