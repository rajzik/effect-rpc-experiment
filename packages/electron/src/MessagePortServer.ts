/**
 * A generic `effect/rpc` server transport over message ports, with no Electron dependency.
 *
 * `MessagePortServer` implements `RpcServer.Protocol` for Electron `MessagePortMain`, DOM
 * `MessagePort` and Node `worker_threads` ports: every attached port is one rpc client.
 * `MainRpcServer` builds on it for renderers; use it directly for utility processes, worker
 * threads or a custom handshake. The client side is `messagePortLink`.
 *
 * @since 0.1.0
 */
import { Effect, Layer, Queue, Schema, Scope } from 'effect';
import { RpcMessage, RpcSerialization, RpcServer } from 'effect/rpc';
import type { Rpc, RpcGroup } from 'effect/rpc';
import { Router } from '@rpc-effect/core';
import type { Handlers } from '@rpc-effect/server';
import { closePort, listen, post, readyFrame } from './internal/port.js';
import type { AnyPort } from './types.js';

/**
 * Options of {@link MessagePortServer.make}.
 *
 * @category options
 * @since 0.1.0
 */
export interface MessagePortServerOptions {
  /**
   * Encodes every protocol message to one frame (a string, or bytes for binary formats).
   * Defaults to `RpcSerialization.json`; the client must use the same serialization.
   */
  readonly serialization?: RpcSerialization.RpcSerialization['Service'] | undefined;
}

/**
 * Options of `MessagePortServer.attach`.
 *
 * @category options
 * @since 0.1.0
 */
export interface AttachOptions {
  /**
   * Trusted headers added to every request of this connection. They replace any header of the
   * same name sent by the client, so a renderer cannot spoof them; an `undefined` value only
   * removes the client's header.
   */
  readonly headers?: Readonly<Record<string, string | undefined>> | undefined;
}

/**
 * An `RpcServer.Protocol` over message ports: every attached port is one rpc client.
 *
 * **Details**
 *
 * - Created by {@link MessagePortServer.make} (bare protocol, you run `RpcServer` yourself) or
 *   {@link MessagePortServer.serve} (protocol plus a running `RpcServer` for a router).
 *
 * @category models
 * @since 0.1.0
 */
export interface MessagePortServer {
  /** The `effect/rpc` server protocol; provide it to `RpcServer.make` / `RpcServer.layer`. */
  readonly protocol: RpcServer.Protocol['Service'];
  /**
   * Starts serving rpc requests received on `port` and returns its client id. When the port
   * closes (or the peer sends its close frame) the client is disconnected: its in-flight
   * handlers and streams are interrupted. Closing the server's scope closes every port.
   */
  readonly attach: (port: AnyPort, options?: AttachOptions) => Effect.Effect<number>;
}

/**
 * Options of {@link MessagePortServer.serve}, also accepted by `MainRpcServer`.
 *
 * @category options
 * @since 0.1.0
 */
export interface ServeOptions<LOut, LE, LR> extends MessagePortServerOptions {
  /**
   * The handler layer (e.g. `Handlers.make(router, {...})`) merged with the server
   * implementations of the router's middleware. Whatever it does not provide stays a
   * requirement of the returned effect.
   */
  readonly handlers?: Layer.Layer<LOut, LE, LR> | undefined;
  /** Disables the server spans `RpcServer` creates for every request. */
  readonly disableTracing?: boolean | undefined;
  /** Prefix of the server span names. */
  readonly spanPrefix?: string | undefined;
  /** Maximum number of requests handled concurrently per server. Defaults to `"unbounded"`. */
  readonly concurrency?: number | 'unbounded' | undefined;
}

type ClientState = {
  readonly port: AnyPort;
  readonly parser: RpcSerialization.Parser;
};

const closed: unique symbol = Symbol('@rpc-effect/electron/closed');

/** A decoded client frame: tagged, with the (still unvalidated) headers of a `Request`. */
interface TaggedMessage {
  readonly _tag: string;
  headers?: unknown;
}

const isMessage = (u: unknown): u is TaggedMessage =>
  typeof u === 'object' && u !== null && '_tag' in u && typeof u._tag === 'string';

/** Placeholder until `RpcServer.Protocol.make` hands over its request writer. */
const ignoreRequest = (): Effect.Effect<void> => Effect.void;

/** Drops client-sent headers named like a trusted header, then appends the trusted ones. */
const withTrustedHeaders = (
  headers: unknown,
  trusted: Readonly<Record<string, string | undefined>>,
): ReadonlyArray<readonly [string, string]> => {
  const names = new Set(Object.keys(trusted).map((key) => key.toLowerCase()));
  const entries: Array<readonly [string, string]> = [];
  for (const [key, value] of Object.entries(trusted)) {
    if (value !== undefined) entries.push([key.toLowerCase(), value]);
  }
  const incoming: ReadonlyArray<unknown> = Array.isArray(headers)
    ? headers
    : typeof headers === 'object' && headers !== null
      ? Object.entries(headers)
      : [];
  const kept = incoming.filter(
    (entry): entry is readonly [string, string] =>
      Array.isArray(entry) &&
      typeof entry[0] === 'string' &&
      typeof entry[1] === 'string' &&
      !names.has(entry[0].toLowerCase()),
  );
  return [...kept, ...entries];
};

/**
 * Creates a {@link MessagePortServer}: an `RpcServer.Protocol` whose clients are message ports
 * (Electron `MessagePortMain`, DOM `MessagePort`, Node `worker_threads` `MessagePort`). Frames
 * are produced by the serialization (JSON strings by default, bytes for binary formats). The
 * ports are closed when the scope closes.
 *
 * **When to use**
 *
 * Use when you need full control over the `RpcServer` (your own `RpcGroup`, options or layer
 * wiring). Prefer {@link serve} to serve an effect-trpc router.
 *
 * **Details**
 *
 * - `attach(port)` sends a ready frame (the client's connection acknowledgement) and returns the
 *   new client id.
 * - Malformed frames are answered with a defect frame; the connection keeps serving.
 *
 * **Example** (Running an `RpcServer` over the bare protocol)
 *
 * ```ts
 * // any Node or Electron main process
 * import { Effect, Schema } from 'effect';
 * import { RpcServer } from 'effect/rpc';
 * import { query, Router } from '@rpc-effect/core';
 * import { Handlers } from '@rpc-effect/server';
 * import { MessagePortServer } from '@rpc-effect/electron/main';
 *
 * const appRouter = Router.make({ ping: query({ success: Schema.String }) });
 * const HandlersLive = Handlers.make(appRouter, { ping: () => Effect.succeed('pong') });
 *
 * const program = Effect.gen(function* () {
 *   const server = yield* MessagePortServer.make();
 *   yield* RpcServer.make(appRouter.group, { disableFatalDefects: true }).pipe(
 *     Effect.provideService(RpcServer.Protocol, server.protocol),
 *     Effect.provide(HandlersLive),
 *     Effect.forkScoped,
 *   );
 *   return server; // call `server.attach(port)` for every connection
 * });
 * ```
 *
 * @see {@link serve}
 * @since 0.1.0
 */
const make = (
  options: MessagePortServerOptions = {},
): Effect.Effect<MessagePortServer, never, Scope.Scope> => {
  const serialization = options.serialization ?? RpcSerialization.json;
  // Used by the synchronous `send` callback, where a failed encode falls back to dropping the frame.
  const encodeDefect = Schema.encodeSync(serialization.codecFor(Schema.Defect()));
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const disconnects = yield* Queue.unbounded<number>();
    const clients = new Map<number, ClientState>();
    const clientIds = new Set<number>();
    let nextClientId = 0;
    let writeRequest: (
      clientId: number,
      data: RpcMessage.FromClientEncoded,
    ) => Effect.Effect<void> = ignoreRequest;

    const send = (clientId: number, response: unknown): void => {
      const client = clients.get(clientId);
      if (client === undefined) return;
      let encoded: string | Uint8Array | undefined;
      try {
        encoded = client.parser.encode(response);
      } catch (cause) {
        try {
          encoded = client.parser.encode(RpcMessage.ResponseDefectEncoded(encodeDefect(cause)));
        } catch {
          return;
        }
      }
      if (encoded === undefined) return;
      post(client.port, encoded);
    };

    const sendDefect = (clientId: number, cause: unknown): void =>
      send(clientId, RpcMessage.ResponseDefectEncoded(encodeDefect(cause)));

    const processFrame = (
      clientId: number,
      parser: RpcSerialization.Parser,
      data: unknown,
      trusted: Readonly<Record<string, string | undefined>> | undefined,
    ): Effect.Effect<void> => {
      let messages: ReadonlyArray<unknown>;
      try {
        if (typeof data !== 'string' && !(data instanceof Uint8Array)) {
          throw new TypeError('Invalid frame: expected a string or bytes');
        }
        messages = parser.decode(data);
      } catch (cause) {
        return Effect.sync(() => sendDefect(clientId, cause));
      }
      return Effect.forEach(
        messages,
        (message) => {
          if (!isMessage(message)) {
            return Effect.sync(() => sendDefect(clientId, 'Invalid message'));
          }
          if (message._tag === 'Request') {
            // Always normalized: malformed headers from a client must not crash the server loop.
            message.headers = withTrustedHeaders(message.headers, trusted ?? {});
          }
          // A defect while routing one message answers with a defect frame; the loop goes on.
          return Effect.catchDefect(
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- decoded frames are handed to `RpcServer` unvalidated, as effect/rpc's own socket / worker protocols do; a malformed message is a defect, answered below
            writeRequest(clientId, message as RpcMessage.FromClientEncoded),
            (defect) => Effect.sync(() => sendDefect(clientId, defect)),
          );
        },
        { discard: true },
      );
    };

    const protocol = yield* RpcServer.Protocol.make((write) => {
      writeRequest = write;
      return Effect.succeed({
        disconnects,
        send: (clientId, response) => Effect.sync(() => send(clientId, response)),
        end: () => Effect.void,
        clientIds: Effect.succeed<ReadonlySet<number>>(clientIds),
        initialMessage: Effect.succeedNone,
        supportsAck: true,
        supportsTransferables: false,
        supportsSpanPropagation: true,
        supportsNotifications: true,
        codecFor: serialization.codecFor,
      });
    });

    const attach = (port: AnyPort, attachOptions: AttachOptions = {}): Effect.Effect<number> =>
      Effect.gen(function* () {
        const clientId = nextClientId++;
        const parser = serialization.makeUnsafe();
        const inbox = yield* Queue.unbounded<unknown>();
        // Frames are queued synchronously and processed in order by one fiber per port.
        const unlisten = listen(
          port,
          (data) => Queue.offerUnsafe(inbox, data),
          () => Queue.offerUnsafe(inbox, closed),
        );
        clients.set(clientId, { port, parser });
        clientIds.add(clientId);
        post(port, readyFrame);
        const trusted = attachOptions.headers;
        yield* Effect.gen(function* () {
          while (true) {
            const data = yield* Queue.take(inbox);
            if (data === closed) return;
            yield* processFrame(clientId, parser, data, trusted);
          }
        }).pipe(
          Effect.ensuring(
            Effect.suspend(() => {
              unlisten();
              closePort(port);
              clients.delete(clientId);
              clientIds.delete(clientId);
              return Queue.offer(disconnects, clientId);
            }),
          ),
          Effect.forkIn(scope),
        );
        return clientId;
      });

    return { protocol, attach };
  });
};

/** `serve` for a router. */
const serveFor = <R extends Router.Any, LOut = never, LE = never, LR = never>(
  router: R,
  options: ServeOptions<LOut, LE, LR> = {},
): Effect.Effect<
  MessagePortServer,
  LE,
  Scope.Scope | LR | Exclude<Handlers.Requirements<R>, LOut>
> =>
  Effect.gen(function* () {
    const server = yield* make(options);
    const run = RpcServer.make(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `Router.Any` erases the group's rpcs on purpose; the return type restores them via `Handlers.Requirements<R>`
      router.group as RpcGroup.RpcGroup<Rpc.Any>,
      {
        disableFatalDefects: true,
        disableTracing: options.disableTracing,
        spanPrefix: options.spanPrefix,
        concurrency: options.concurrency,
      },
    ).pipe(Effect.provideService(RpcServer.Protocol, server.protocol));
    const handlers =
      options.handlers === undefined ? undefined : yield* Layer.build(options.handlers);
    yield* Effect.forkScoped(handlers === undefined ? run : Effect.provide(run, handlers));
    return server;
  });

/** `serve` for a router or a router service: normalises the input with `Router.from`. */
const serveFromInput = (
  input: Router.Input,
  options?: ServeOptions<never, never, never>,
): unknown => {
  const router: Router.Any = Router.from(input);
  return serveFor(router, options);
};

/**
 * Runs an rpc server for `router` over a {@link MessagePortServer} in the current scope and
 * returns it; call `attach(port)` for every connection. Handler defects fail only their call
 * (`disableFatalDefects: true`).
 *
 * **When to use**
 *
 * Use to serve a router to a peer that is not a renderer with the preload bridge: a Node
 * worker thread, an Electron utility process, or a renderer reached through your own
 * handshake. Prefer `MainRpcServer` for renderers.
 *
 * **Details**
 *
 * - `router` is a `Router.make` router or a router service class (`Router.Input`); a service is
 *   normalised with `Router.from` (its `make` runs once per process) and typed as `Router.Of<X>`.
 * - `handlers` is built once in the current scope. Services it does not provide stay
 *   requirements of the returned effect.
 * - `attach(port, { headers })` adds trusted headers to every request of that connection; they
 *   replace client headers of the same name (case-insensitive).
 * - When a port closes (or the peer sends its close frame) its client is disconnected and its
 *   in-flight handlers and streams are interrupted. Closing the scope closes every port, so
 *   pending client calls reject with `RpcTransportError`.
 *
 * **Gotchas**
 *
 * - The client must use the same `serialization` (default `RpcSerialization.json`).
 *
 * **Example** (Serving a router to a Node worker thread)
 *
 * ```ts
 * // main.ts (Electron main process or any Node process)
 * import { MessageChannel, Worker } from 'node:worker_threads';
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@rpc-effect/core';
 * import { Handlers } from '@rpc-effect/server';
 * import { MessagePortServer } from '@rpc-effect/electron/main';
 *
 * const appRouter = Router.make({ ping: query({ success: Schema.String }) });
 * const HandlersLive = Handlers.make(appRouter, { ping: () => Effect.succeed('pong') });
 *
 * const program = Effect.gen(function* () {
 *   const server = yield* MessagePortServer.serve(appRouter, { handlers: HandlersLive });
 *   const { port1, port2 } = new MessageChannel();
 *   // Trusted headers: the worker cannot override them.
 *   yield* server.attach(port2, { headers: { 'x-caller': 'worker' } });
 *   // The worker calls the router with `messagePortLink(workerData.port)`.
 *   const worker = new Worker(new URL('./worker.js', import.meta.url), {
 *     workerData: { port: port1 },
 *     transferList: [port1],
 *   });
 *   yield* Effect.addFinalizer(() => Effect.promise(() => worker.terminate()));
 *   return yield* Effect.never;
 * });
 *
 * Effect.runFork(Effect.scoped(program));
 * ```
 *
 * @see {@link make}
 * @since 0.1.0
 */
const serve: {
  <R extends Router.Any, LOut = never, LE = never, LR = never>(
    router: R,
    options?: ServeOptions<LOut, LE, LR>,
  ): Effect.Effect<
    MessagePortServer,
    LE,
    Scope.Scope | LR | Exclude<Handlers.Requirements<R>, LOut>
  >;
  <X extends Router.Input, LOut = never, LE = never, LR = never>(
    router: X,
    options?: ServeOptions<LOut, LE, LR>,
  ): Effect.Effect<
    MessagePortServer,
    LE,
    Scope.Scope | LR | Exclude<Handlers.Requirements<Router.Of<X>>, LOut>
  >;
} =
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- both overloads normalise the input with `Router.from` and continue with that router, which is what the implementation does; checking the overloads against it structurally instantiates `Router.Of<Router.Input>`, which is too deep
  serveFromInput as unknown as typeof serve;

/**
 * A generic `effect/rpc` server transport over message ports.
 *
 * **When to use**
 *
 * Use for message-port peers other than preload-bridged renderers (worker threads, utility
 * processes, custom handshakes). Members: `serve` (router + handlers, returns `{ protocol,
 * attach }`) and `make` (bare protocol). For renderers use `MainRpcServer`, which wraps `serve`.
 *
 * **Details**
 *
 * - Accepts Web-style (`PortLike`) and EventEmitter-style (`PortMainLike`) ports.
 * - Each side posts a close frame before closing its port, so the peer notices even where the
 *   platform emits no `close` event.
 *
 * **Example** (Serving a router and attaching one port)
 *
 * ```ts
 * // any Node or Electron main process
 * import { MessageChannel } from 'node:worker_threads';
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@rpc-effect/core';
 * import { createClient } from '@rpc-effect/client';
 * import { Handlers } from '@rpc-effect/server';
 * import { messagePortLink, MessagePortServer } from '@rpc-effect/electron';
 *
 * const appRouter = Router.make({ ping: query({ success: Schema.String }) });
 * const HandlersLive = Handlers.make(appRouter, { ping: () => Effect.succeed('pong') });
 *
 * const program = Effect.gen(function* () {
 *   const server = yield* MessagePortServer.serve(appRouter, { handlers: HandlersLive });
 *   const { port1, port2 } = new MessageChannel();
 *   yield* server.attach(port2);
 *   const client = createClient(appRouter, { link: messagePortLink(port1) });
 *   const pong = yield* Effect.promise(() => client.ping());
 *   yield* Effect.promise(() => client.dispose());
 *   return pong;
 * });
 *
 * const pong = await Effect.runPromise(Effect.scoped(program));
 * ```
 *
 * @see {@link MessagePortServer.serve}
 * @category adapters
 * @since 0.1.0
 */
export const MessagePortServer = {
  make,
  serve,
} as const;
