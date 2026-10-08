import { Effect, Layer, Option, Queue, Schema, Scope } from 'effect';
import { RpcMessage, RpcSerialization, RpcServer } from 'effect/rpc';
import type { Rpc, RpcGroup } from 'effect/rpc';
import type { Router } from '@effect-trpc/core';
import type { Handlers } from '@effect-trpc/server';
import { closePort, listen, post, readyFrame } from './internal/port.js';
import type { AnyPort } from './types.js';

/** Options of {@link MessagePortServer.make}. */
export interface MessagePortServerOptions {
  /**
   * Encodes every protocol message to one frame (a string, or bytes for binary formats).
   * Defaults to `RpcSerialization.json`; the client must use the same serialization.
   */
  readonly serialization?: RpcSerialization.RpcSerialization['Service'] | undefined;
}

/** Options of {@link MessagePortServer.attach}. */
export interface AttachOptions {
  /**
   * Trusted headers added to every request of this connection. They replace any header of the
   * same name sent by the client, so a renderer cannot spoof them; an `undefined` value only
   * removes the client's header.
   */
  readonly headers?: Readonly<Record<string, string | undefined>> | undefined;
}

/** An `RpcServer.Protocol` over message ports: every attached port is one rpc client. */
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

/** Options of {@link MessagePortServer.serve}. */
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

const closed: unique symbol = Symbol('@effect-trpc/electron/closed');

const isMessage = (u: unknown): u is { readonly _tag: string } =>
  typeof u === 'object' && u !== null && typeof (u as { _tag?: unknown })._tag === 'string';

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
 * are strings produced by the serialization (JSON by default). The ports are closed when the
 * scope closes.
 */
const make = (
  options: MessagePortServerOptions = {},
): Effect.Effect<MessagePortServer, never, Scope.Scope> =>
  Effect.gen(function* () {
    const serialization = options.serialization ?? RpcSerialization.json;
    const encodeDefect = Schema.encodeSync(serialization.codecFor(Schema.Defect()));
    const scope = yield* Effect.scope;
    const disconnects = yield* Queue.unbounded<number>();
    const clients = new Map<number, ClientState>();
    const clientIds = new Set<number>();
    let nextClientId = 0;
    let writeRequest: (
      clientId: number,
      data: RpcMessage.FromClientEncoded,
    ) => Effect.Effect<void> = () => Effect.void;

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
            const request = message as { headers?: unknown };
            request.headers = withTrustedHeaders(request.headers, trusted ?? {});
          }
          // A defect while routing one message answers with a defect frame; the loop goes on.
          return Effect.catchDefect(
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
        clientIds: Effect.sync((): ReadonlySet<number> => clientIds),
        initialMessage: Effect.succeed(Option.none()),
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

/**
 * Runs an rpc server for `router` over a {@link MessagePortServer} in the current scope and
 * returns it; call `attach(port)` for every connection. Handler defects fail only their call
 * (`disableFatalDefects: true`).
 */
const serve = <R extends Router.Any, LOut = never, LE = never, LR = never>(
  router: R,
  options: ServeOptions<LOut, LE, LR> = {},
): Effect.Effect<
  MessagePortServer,
  LE,
  Scope.Scope | LR | Exclude<Handlers.Requirements<R>, LOut>
> =>
  Effect.gen(function* () {
    const server = yield* make(options);
    let run: Effect.Effect<never, unknown, unknown> = RpcServer.make(
      router.group as RpcGroup.RpcGroup<Rpc.Any>,
      {
        disableFatalDefects: true,
        disableTracing: options.disableTracing,
        spanPrefix: options.spanPrefix,
        concurrency: options.concurrency,
      },
    ).pipe(Effect.provideService(RpcServer.Protocol, server.protocol));
    if (options.handlers !== undefined) {
      const context = yield* Layer.build(options.handlers);
      run = Effect.provide(run, context);
    }
    yield* Effect.forkScoped(run);
    return server;
  }) as Effect.Effect<
    MessagePortServer,
    LE,
    Scope.Scope | LR | Exclude<Handlers.Requirements<R>, LOut>
  >;

/** A generic `effect/rpc` server transport over message ports. */
export const MessagePortServer = {
  make,
  serve,
} as const;
