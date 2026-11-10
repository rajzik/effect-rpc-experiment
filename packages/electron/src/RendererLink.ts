/**
 * The renderer-process link: connects an effect-trpc client to `MainRpcServer`.
 *
 * `rendererLink` opens a `MessageChannel` per client and hands one end to the main process
 * through the preload bridge (`installPreloadBridge`), then speaks `effect/rpc` over the other
 * end with `messagePortLink`. Pass it to `createClient` from `@rpc-effect/client`.
 *
 * @since 0.1.0
 */
import type { Link } from '@rpc-effect/client';
import { messagePortLink } from './MessagePortLink.js';
import type { MessagePortLinkOptions } from './MessagePortLink.js';
import { connectMessageType, defaultChannel } from './types.js';
import type { ConnectMessage } from './PreloadBridge.js';
import type { MessageChannelLike, PortLike, WindowLike } from './types.js';

const defaultConnectTimeout = '10 seconds';

/**
 * Options of {@link rendererLink}.
 *
 * @category options
 * @since 0.1.0
 */
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

/** The optional `MessageChannel` global of a renderer. */
type ChannelGlobal<Port> = { readonly MessageChannel?: MessageChannelLike<Port> | undefined };

/**
 * The renderer-side link. Every client (`createClient(router, { link: rendererLink() })`) opens
 * a `MessageChannel`, hands one end to the main process through the preload bridge
 * (`window.postMessage({ type: "effect-trpc/connect", channel }, "*", [port])`) and talks over
 * the other end. `client.dispose()` closes the connection.
 *
 * **When to use**
 *
 * In an Electron renderer whose preload script calls `installPreloadBridge` and whose main
 * process runs `MainRpcServer`. Use `messagePortLink` when you already hold a connected port.
 *
 * **Details**
 *
 * - The channel is opened lazily, on the client's first call. One link can back several
 *   clients; each gets its own connection.
 * - Promise-client calls reject with `ClientError<E> = E | RpcDefect | RpcTransportError |
 *   RpcInterrupted` (typed `Schema.TaggedError` instances for `E`); `client.$effect` calls fail
 *   with `E | RpcTransportError`.
 * - `connectTimeout` defaults to `"10 seconds"`: without an acknowledgement from the main
 *   process (missing bridge, channel mismatch, server not started) calls fail with
 *   `RpcTransportError` instead of hanging.
 * - Works with `@rpc-effect/tanstack-react-query` like any other link.
 *
 * **Gotchas**
 *
 * - A page reload destroys the client; the reloaded page creates a new client and connection.
 *   The main process interrupts the old connection's handlers once Electron reports its
 *   `MessagePortMain` closed. Call `client.dispose()` (e.g. on `pagehide`) to close it eagerly.
 * - When the main process closes the port (`server.dispose()`), pending calls reject with
 *   `RpcTransportError` and later calls on that client fail immediately: create a new client.
 * - The `window` / `MessageChannel` options exist for tests (Node `worker_threads`); leave them
 *   unset in a real renderer.
 *
 * **Example** (A renderer client)
 *
 * ```ts
 * // renderer.ts (renderer process; the router module is shared with the main process)
 * import { Schema } from 'effect';
 * import { query, Router, subscription } from '@rpc-effect/core';
 * import { createClient, RpcTransportError } from '@rpc-effect/client';
 * import { rendererLink } from '@rpc-effect/electron/renderer';
 *
 * class User extends Schema.Class<User>('User')({ id: Schema.String, name: Schema.String }) {}
 * class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { id: Schema.String }) {}
 *
 * const appRouter = Router.make({
 *   user: { byId: query({ payload: { id: Schema.String }, success: User, error: NotFound }) },
 *   clock: subscription({ success: Schema.Number }),
 * });
 *
 * export const client = createClient(appRouter, { link: rendererLink() });
 *
 * try {
 *   const user = await client.user.byId({ id: '1' }); // a `User` instance
 *   console.log(user.name);
 * } catch (error) {
 *   if (error instanceof NotFound) console.log('no user', error.id);
 *   else if (error instanceof RpcTransportError) console.log('main process unreachable');
 *   else throw error;
 * }
 *
 * for await (const now of client.clock()) console.log(now);
 * ```
 *
 * @see {@link messagePortLink}
 * @category links
 * @since 0.1.0
 */
export const rendererLink = <Port = PortLike>(options: RendererLinkOptions<Port> = {}): Link => {
  const channel = options.channel ?? defaultChannel;
  return messagePortLink(
    () => {
      const target =
        options.window ??
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reads the optional renderer global without depending on DOM lib types; `undefined` (no renderer) is handled below and `Port` is the caller's declared port type
        (globalThis as { readonly window?: WindowLike<Port> | undefined }).window;
      const Channel =
        options.MessageChannel ??
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same as `window`: the optional `MessageChannel` global, typed with the caller's `Port`
        (globalThis as unknown as ChannelGlobal<Port>).MessageChannel;
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
