/**
 * Client links over a message port, the client half of `MessagePortServer` / `MainRpcServer`.
 *
 * `messagePortLink` turns a Web-style port (DOM `MessagePort`, Node `worker_threads` port) into
 * an `@effect-trpc/client` `Link`; `messagePortProtocolClient` is the underlying
 * `RpcClient.Protocol`. `rendererLink` builds on them for Electron renderers.
 *
 * @since 0.1.0
 */
import { Duration, Effect, Layer, Queue } from 'effect';
import type { Scope } from 'effect';
import { RpcClient, RpcClientError, RpcSerialization } from 'effect/rpc';
import type { RpcMessage } from 'effect/rpc';
import { Link } from '@effect-trpc/client';
import { closePort, listen, post, readyFrame } from './internal/port.js';
import type { PortLike } from './types.js';

/**
 * A port, or a (possibly async) function opening a new one for every client.
 *
 * **Details**
 *
 * - A bare port can back one client only: a second client on the same link dies with a defect
 *   (`RpcDefect` "already used"). A function is called once per client.
 *
 * @category models
 * @since 0.1.0
 */
export type PortSource = PortLike | (() => PortLike | PromiseLike<PortLike>);

/**
 * Options of {@link messagePortLink} and {@link messagePortProtocolClient}.
 *
 * @category options
 * @since 0.1.0
 */
export interface MessagePortLinkOptions {
  /**
   * Encodes every protocol message to one frame (a string, or bytes for binary formats).
   * Defaults to `RpcSerialization.json`; the server must use the same serialization.
   */
  readonly serialization?: RpcSerialization.RpcSerialization['Service'] | undefined;
  /**
   * Fails every call with `RpcTransportError` (and closes the port) when the server has not
   * acknowledged the connection within this duration, instead of waiting forever (e.g. the
   * preload bridge is missing or the channel does not match). No timeout by default.
   */
  readonly connectTimeout?: Duration.Input | undefined;
}

const closed: unique symbol = Symbol('@effect-trpc/electron/closed');
const timedOut: unique symbol = Symbol('@effect-trpc/electron/timedOut');

const transportError = (message: string, cause?: unknown): RpcClientError.RpcClientError =>
  new RpcClientError.RpcClientError({
    reason: new RpcClientError.RpcClientDefect({ message, cause }),
  });

/**
 * An `RpcClient.Protocol` over one message port, for the current scope. Calls are multiplexed
 * over the port; acks give subscriptions backpressure. When the port closes (or the server
 * sends its close frame) every pending call fails with `RpcClientError` and later calls fail
 * immediately. Closing the scope closes the port.
 *
 * **When to use**
 *
 * Use to build a custom `Link` (e.g. with `Link.fromProtocol`) or a raw `effect/rpc`
 * `RpcClient`. Prefer {@link messagePortLink} for an effect-trpc client.
 *
 * **Details**
 *
 * - With `connectTimeout`, the port is closed and every call fails when no frame (not even the
 *   server's ready frame) arrives in time.
 * - The `RpcClientError`s it produces surface as `RpcTransportError` in effect-trpc clients.
 *
 * **Example** (A custom link from the protocol)
 *
 * ```ts
 * // renderer, worker or any process holding a Web-style port
 * import { Layer } from 'effect';
 * import { RpcClient } from 'effect/rpc';
 * import { Link } from '@effect-trpc/client';
 * import { messagePortProtocolClient, type PortLike } from '@effect-trpc/electron/renderer';
 *
 * declare const port: PortLike;
 *
 * // Equivalent to `messagePortLink(port, { connectTimeout: '5 seconds' })`.
 * export const link = Link.fromProtocol(
 *   Layer.effect(RpcClient.Protocol)(
 *     messagePortProtocolClient(port, { connectTimeout: '5 seconds' }),
 *   ),
 * );
 * ```
 *
 * @see {@link messagePortLink}
 * @category links
 * @since 0.1.0
 */
export const messagePortProtocolClient = (
  port: PortLike,
  options: MessagePortLinkOptions = {},
): Effect.Effect<RpcClient.Protocol['Service'], never, Scope.Scope> =>
  RpcClient.Protocol.make((writeResponse, clientIds) =>
    Effect.gen(function* () {
      const serialization = options.serialization ?? RpcSerialization.json;
      const parser = serialization.makeUnsafe();
      const requestClients = new Map<string | number, number>();
      let currentError: RpcClientError.RpcClientError | undefined;
      let connected = false;
      const inbox = yield* Queue.unbounded<unknown>();

      const broadcast = (response: RpcMessage.FromServerEncoded): Effect.Effect<void> =>
        Effect.forEach(Array.from(clientIds), (clientId) => writeResponse(clientId, response), {
          discard: true,
        });

      const fail = (error: RpcClientError.RpcClientError): Effect.Effect<void> => {
        currentError ??= error;
        requestClients.clear();
        return broadcast({ _tag: 'ClientProtocolError', error });
      };

      const route = (response: unknown): Effect.Effect<void> => {
        if (typeof response !== 'object' || response === null) return Effect.void;
        const message = response as RpcMessage.FromServerEncoded;
        if (message._tag === 'Pong') return Effect.void;
        if (Object.hasOwn(message, 'requestId')) {
          const requestId = (message as { readonly requestId: string | number }).requestId;
          const clientId = requestClients.get(requestId);
          if (clientId === undefined) return Effect.void;
          if (message._tag === 'Exit') requestClients.delete(requestId);
          return writeResponse(clientId, message);
        }
        return broadcast(message);
      };

      const processFrame = (data: unknown): Effect.Effect<void> => {
        connected = true;
        if (data === readyFrame) return Effect.void;
        let responses: ReadonlyArray<unknown>;
        try {
          if (typeof data !== 'string' && !(data instanceof Uint8Array)) {
            throw new TypeError('Invalid frame: expected a string or bytes');
          }
          responses = parser.decode(data);
        } catch (cause) {
          return broadcast({
            _tag: 'ClientProtocolError',
            error: transportError('Error decoding message', cause),
          });
        }
        return Effect.forEach(responses, route, { discard: true });
      };

      const timeout = options.connectTimeout;
      const timeoutMessage = `No response from the rpc server within ${
        timeout === undefined ? '' : Duration.format(Duration.fromInputUnsafe(timeout))
      }: is the preload bridge installed and the server listening on the same channel?`;

      // Frames are queued synchronously and processed in order; the close marker is queued
      // behind them, so responses that arrived before the close are still delivered.
      const unlisten = listen(
        port,
        (data) => Queue.offerUnsafe(inbox, data),
        () => Queue.offerUnsafe(inbox, closed),
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          unlisten();
          closePort(port);
        }),
      );
      yield* Effect.gen(function* () {
        while (true) {
          const data = yield* Queue.take(inbox);
          if (data === closed) {
            return yield* fail(transportError('The MessagePort was closed'));
          }
          if (data === timedOut) {
            closePort(port);
            return yield* fail(transportError(timeoutMessage));
          }
          yield* processFrame(data);
        }
      }).pipe(Effect.forkScoped);
      if (timeout !== undefined) {
        yield* Effect.sleep(timeout).pipe(
          Effect.andThen(
            Effect.sync(() => {
              if (!connected) Queue.offerUnsafe(inbox, timedOut);
            }),
          ),
          Effect.forkScoped,
        );
      }

      return {
        send: (_clientId, request) => {
          if (currentError !== undefined) return Effect.fail(currentError);
          return Effect.sync(() => {
            if (request._tag === 'Request') requestClients.set(request.id, _clientId);
            const encoded = parser.encode(request);
            if (encoded === undefined) return;
            post(port, encoded);
          });
        },
        supportsAck: true,
        supportsTransferables: false,
        codecFor: serialization.codecFor,
      };
    }),
  );

const acquirePort = (source: PortSource, used: { value: boolean }): Effect.Effect<PortLike> => {
  if (typeof source !== 'function') {
    return Effect.suspend(() => {
      if (used.value) {
        return Effect.die(
          new Error(
            'messagePortLink: this MessagePort is already used by another client. ' +
              'Pass a function that opens a new port to share the link between clients.',
          ),
        );
      }
      used.value = true;
      return Effect.succeed(source);
    });
  }
  return Effect.promise(async () => source());
};

/**
 * A link over a message port (DOM `MessagePort`, Node `worker_threads` `MessagePort`) whose
 * peer is served by `MessagePortServer` / `MainRpcServer`. Pass a port (usable by one client) or
 * a function opening a new port for every client. `client.dispose()` closes the port; a port
 * closed by the peer fails pending calls with `RpcTransportError`.
 *
 * **When to use**
 *
 * Use when you already hold a port connected to a `MessagePortServer` (worker thread, iframe,
 * custom handshake). In an Electron renderer with the preload bridge use `rendererLink`.
 *
 * **Details**
 *
 * - Promise-client calls reject with `ClientError<E> = E | RpcDefect | RpcTransportError |
 *   RpcInterrupted`; `client.$effect` calls fail with `E | RpcTransportError`.
 * - No `connectTimeout` by default: if nobody serves the port, calls wait forever.
 *
 * **Gotchas**
 *
 * - Sharing a link built from a bare port between two `createClient` calls fails the second
 *   client's calls with `RpcDefect`. Pass a function that opens a new port instead.
 * - Electron's `MessagePortMain` is not a `PortLike`; it can only be the server side.
 *
 * **Example** (Calling a router from a Node worker thread)
 *
 * ```ts
 * // worker.ts (worker thread; the parent attached the other end with `MessagePortServer`)
 * import { workerData, type MessagePort } from 'node:worker_threads';
 * import { Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { createClient } from '@effect-trpc/client';
 * import { messagePortLink } from '@effect-trpc/electron';
 *
 * const appRouter = Router.make({ ping: query({ success: Schema.String }) });
 * const { port } = workerData as { readonly port: MessagePort };
 *
 * const client = createClient(appRouter, {
 *   link: messagePortLink(port, { connectTimeout: '5 seconds' }),
 * });
 * console.log(await client.ping()); // 'pong'
 * await client.dispose(); // closes the port; the server interrupts this connection's handlers
 * ```
 *
 * @see {@link messagePortProtocolClient}
 * @category links
 * @since 0.1.0
 */
export const messagePortLink = (source: PortSource, options: MessagePortLinkOptions = {}): Link => {
  const used = { value: false };
  return Link.fromProtocol(
    Layer.effect(RpcClient.Protocol)(
      Effect.flatMap(acquirePort(source, used), (port) => messagePortProtocolClient(port, options)),
    ),
  );
};
