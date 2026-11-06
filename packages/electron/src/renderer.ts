/**
 * Renderer entry (`@effect-trpc/electron/renderer`): client links for renderer processes.
 *
 * Exports `rendererLink` (connects to `MainRpcServer` through the preload bridge) and the
 * lower-level `messagePortLink` / `messagePortProtocolClient`. Pass a link to `createClient`
 * from `@effect-trpc/client`. Import it only in renderers (or other clients holding a port).
 *
 * @since 0.1.0
 */
export { rendererLink, type RendererLinkOptions } from './RendererLink.js';
export {
  messagePortLink,
  messagePortProtocolClient,
  type MessagePortLinkOptions,
  type PortSource,
} from './MessagePortLink.js';
export {
  connectMessageType,
  defaultChannel,
  type Frame,
  type MessageChannelLike,
  type MessageEventLike,
  type PortListener,
  type PortLike,
  type WindowLike,
  type WindowMessageEventLike,
} from './types.js';
