// Public API of @effect-trpc/electron. Process-specific entries: `./main.ts`, `./preload.ts`,
// `./renderer.ts`.
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
