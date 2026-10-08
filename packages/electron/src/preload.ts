// Preload entry (sandbox friendly, no Effect): `import { installPreloadBridge } from '@effect-trpc/electron/preload'`.
export {
  installPreloadBridge,
  type ConnectMessage,
  type PreloadBridgeOptions,
} from './PreloadBridge.js';
export {
  connectMessageType,
  defaultChannel,
  type Frame,
  type IpcRendererLike,
  type PortLike,
  type PortListener,
  type MessageEventLike,
  type WindowLike,
  type WindowMessageEventLike,
} from './types.js';
