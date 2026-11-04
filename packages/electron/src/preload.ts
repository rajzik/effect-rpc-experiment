/**
 * Preload entry (`@effect-trpc/electron/preload`): the port-forwarding bridge for preload
 * scripts.
 *
 * Exports `installPreloadBridge` and the handshake constants and types. It imports no Effect and
 * no Node APIs, so it bundles into a tiny sandboxed preload script. Import it only in preload
 * scripts.
 *
 * @since 0.1.0
 */
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
