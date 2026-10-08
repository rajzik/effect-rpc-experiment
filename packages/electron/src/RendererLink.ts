import type { Link } from '@effect-trpc/client';
import { messagePortLink } from './MessagePortLink.js';
import type { MessagePortLinkOptions } from './MessagePortLink.js';
import { connectMessageType, defaultChannel } from './types.js';
import type { ConnectMessage } from './PreloadBridge.js';
import type { MessageChannelLike, PortLike, WindowLike } from './types.js';

const defaultConnectTimeout = '10 seconds';

/** Options of {@link rendererLink}. */
export interface RendererLinkOptions<Port = PortLike> extends MessagePortLinkOptions {
  /** The IPC channel (must match the preload bridge and `MainRpcServer`). Default `"effect-trpc"`. */
  readonly channel?: string | undefined;
  /** The window the preload bridge listens on. Defaults to `globalThis.window`. */
  readonly window?: WindowLike<Port> | undefined;
  /** The `MessageChannel` constructor. Defaults to `globalThis.MessageChannel`. */
  readonly MessageChannel?: MessageChannelLike<Port> | undefined;
  /**
   * Fails the calls of a client with `RpcTransportError` when the main process has not
   * acknowledged its connection in time (missing preload bridge, channel mismatch, server not
   * started). Defaults to `"10 seconds"`.
   */
  readonly connectTimeout?: MessagePortLinkOptions['connectTimeout'];
}

/**
 * The renderer-side link. Every client (`createClient(router, { link: rendererLink() })`) opens
 * a `MessageChannel`, hands one end to the main process through the preload bridge
 * (`window.postMessage({ type: "effect-trpc/connect", channel }, "*", [port])`) and talks over
 * the other end. `client.dispose()` closes the connection.
 */
export const rendererLink = <Port = PortLike>(options: RendererLinkOptions<Port> = {}): Link => {
  const channel = options.channel ?? defaultChannel;
  return messagePortLink(
    () => {
      const target =
        options.window ?? (globalThis as { readonly window?: WindowLike<Port> | undefined }).window;
      const Channel =
        options.MessageChannel ??
        (
          globalThis as unknown as {
            readonly MessageChannel?: MessageChannelLike<Port> | undefined;
          }
        ).MessageChannel;
      if (target === undefined || Channel === undefined) {
        throw new Error('rendererLink: no window / MessageChannel (pass them outside a renderer)');
      }
      const { port1, port2 } = new Channel();
      const message: ConnectMessage = { type: connectMessageType, channel };
      target.postMessage(message, '*', [port2]);
      return port1;
    },
    { ...options, connectTimeout: options.connectTimeout ?? defaultConnectTimeout },
  );
};
