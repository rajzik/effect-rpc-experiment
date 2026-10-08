import { Effect, Layer } from 'effect';
import type { Context, Scope } from 'effect';
import {
  FetchHttpClient,
  Headers,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
} from 'effect/http';
import { RpcClient, RpcSerialization, RpcServer } from 'effect/rpc';
import type { Rpc, RpcClientError, RpcGroup, RpcMessage } from 'effect/rpc';
import { Socket } from 'effect/socket';

const TypeId = '~@effect-trpc/client/Link' as const;

/**
 * A transport: turns an `RpcGroup` into a connected `effect/rpc` client.
 *
 * `makeClient` runs once per `createClient` instance (lazily, on the first call) inside the
 * client's scope; closing that scope (`client.dispose()`) releases connections, sockets and
 * in-process servers.
 *
 * `Handlers` is a type-level marker used by {@link localLink}: it records which server services
 * (handlers and server middleware) the link provides, so `createClient` can reject a local link
 * whose handler layer does not implement every procedure of the router. Network links leave it
 * as `unknown` (compatible with every router).
 */
export interface Link<in Handlers = unknown> {
  readonly [TypeId]: typeof TypeId;
  readonly makeClient: <Rpcs extends Rpc.Any>(
    group: RpcGroup.RpcGroup<Rpcs>,
  ) => Effect.Effect<
    RpcClient.RpcClient<Rpcs, RpcClientError.RpcClientError>,
    never,
    Scope.Scope | Rpc.MiddlewareClient<Rpcs>
  >;
  /** Type-level only: the server services a local link provides. Always `undefined` at runtime. */
  readonly '~handlers'?: (handlers: Handlers) => void;
}

/** The `RpcSerialization` used by a link: `"ndjson"` (default), `"json"` or a custom layer. */
export type SerializationOption =
  | 'json'
  | 'ndjson'
  | Layer.Layer<RpcSerialization.RpcSerialization>;

/**
 * Headers for every request of a link: a static value, or a (possibly async) function evaluated
 * once per request (tRPC's `headers()` option).
 */
export type HeadersOption = Headers.Input | (() => Headers.Input | PromiseLike<Headers.Input>);

const serializationLayer = (
  option: SerializationOption | undefined,
): Layer.Layer<RpcSerialization.RpcSerialization> =>
  option === undefined || option === 'ndjson'
    ? RpcSerialization.layerNdjson
    : option === 'json'
      ? RpcSerialization.layerJson
      : option;

/**
 * Creates a link from a `makeClient` function. The function must work for any group (it is
 * usually `RpcClient.make(group)` with a protocol provided).
 */
const make = (makeClient: Link['makeClient']): Link => ({ [TypeId]: TypeId, makeClient });

/**
 * Creates a link from an `RpcClient.Protocol` layer. The layer is built in the client's scope,
 * so its resources (connections, sockets) live until `client.dispose()`.
 */
const fromProtocol = <E>(protocol: Layer.Layer<RpcClient.Protocol, E>): Link =>
  make((group) =>
    Effect.gen(function* () {
      const context = yield* Layer.build(Layer.orDie(protocol));
      return yield* RpcClient.make(group).pipe(Effect.provideContext(context));
    }),
  );

/** Link constructors. */
export const Link = {
  make,
  fromProtocol,
} as const;

const assertAbsoluteUrl = (link: string, url: string, schemes: ReadonlyArray<string>): void => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `${link}: url must be an absolute URL (e.g. "${schemes[0]}://localhost:3000/rpc"), got "${url}". ` +
        `In the browser, build it from the page origin: new URL("/rpc", location.origin).href`,
    );
  }
  if (!schemes.includes(parsed.protocol.slice(0, -1))) {
    throw new Error(
      `${link}: url must use ${schemes.map((s) => `${s}:`).join(' or ')}, got "${url}"`,
    );
  }
};

const resolveHeaders = (
  headers: HeadersOption,
  request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<Headers.Headers, HttpClientError.HttpClientError> =>
  typeof headers === 'function'
    ? Effect.tryPromise({
        try: async () => Headers.fromInput(await headers()),
        catch: (cause) =>
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              cause,
              description: 'The headers() function of httpLink threw',
            }),
          }),
      })
    : Effect.succeed(Headers.fromInput(headers));

/** Options of {@link httpLink}. */
export interface HttpLinkOptions {
  /** ABSOLUTE url of the rpc endpoint, e.g. `"http://localhost:3000/rpc"`. */
  readonly url: string | URL;
  /** HTTP headers sent with every request; a function is evaluated once per request. */
  readonly headers?: HeadersOption | undefined;
  /** Custom `fetch` (a test double, a web handler adapter, a polyfill, ...). */
  readonly fetch?: typeof globalThis.fetch | undefined;
  /** Wire format, must match the server. Default `"ndjson"` (required for streaming). */
  readonly serialization?: SerializationOption | undefined;
}

/**
 * A link over HTTP (`fetch`), one POST per call. Responses are streamed with NDJSON, so
 * subscriptions work over plain HTTP. The server must use `RpcServer.layerHttp` with
 * `protocol: "http"` and the same serialization.
 *
 * Non-2xx responses and network errors surface as `RpcTransportError`.
 */
export const httpLink = (options: HttpLinkOptions): Link => {
  const url = String(options.url);
  assertAbsoluteUrl('httpLink', url, ['http', 'https']);
  const { headers, fetch } = options;
  const fetchLayer =
    fetch === undefined
      ? FetchHttpClient.layer
      : FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fetch)));
  const httpClientLayer = Layer.effect(HttpClient.HttpClient)(
    Effect.gen(function* () {
      const ok = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
      return headers === undefined
        ? ok
        : ok.pipe(
            HttpClient.mapRequestEffect((request) =>
              Effect.map(resolveHeaders(headers, request), (resolved) =>
                HttpClientRequest.setHeaders(request, resolved),
              ),
            ),
          );
    }),
  ).pipe(Layer.provide(fetchLayer));
  return fromProtocol(
    RpcClient.layerProtocolHttp({ url }).pipe(
      Layer.provide([httpClientLayer, serializationLayer(options.serialization)]),
    ),
  );
};

/** Options of {@link wsLink}. */
export interface WsLinkOptions {
  /** ABSOLUTE WebSocket url of the rpc endpoint, e.g. `"ws://localhost:3000/rpc"`. */
  readonly url: string | URL;
  /** Wire format, must match the server. Default `"ndjson"`. */
  readonly serialization?: SerializationOption | undefined;
  /** Reconnect on transient socket errors instead of failing in-flight calls. Default `false`. */
  readonly retryTransientErrors?: boolean | undefined;
  /**
   * The WebSocket implementation. Defaults to `globalThis.WebSocket` (browsers, Node >= 22,
   * Deno, Bun).
   */
  readonly WebSocket?: Layer.Layer<Socket.WebSocketConstructor> | undefined;
}

/**
 * A link over a single multiplexed WebSocket connection (opened lazily on the first call,
 * closed by `client.dispose()`). The server must use `RpcServer.layerHttp` with
 * `protocol: "websocket"` and the same serialization.
 */
export const wsLink = (options: WsLinkOptions): Link => {
  const url = String(options.url);
  assertAbsoluteUrl('wsLink', url, ['ws', 'wss']);
  return fromProtocol(
    RpcClient.layerProtocolSocket({ retryTransientErrors: options.retryTransientErrors }).pipe(
      Layer.provide([
        Socket.layerWebSocket(url).pipe(
          Layer.provide(options.WebSocket ?? Socket.layerWebSocketConstructorGlobal),
        ),
        serializationLayer(options.serialization),
      ]),
    ),
  );
};

/** Options of {@link localLink}. */
export interface LocalLinkOptions<Handlers> {
  /**
   * The server implementation: the handlers layer (`router.group.toLayer({...})`) merged with the
   * server-side middleware layers. It is built once per client and released by `dispose()`.
   */
  readonly handlers: Layer.Layer<Handlers, unknown>;
}

/**
 * An in-process link: runs the router's handlers in the same process, with no serialization
 * (values are passed by reference). Ideal for tests, SSR and server-side callers. Handler
 * defects become `RpcDefect` without breaking later calls; interruption reaches the handler.
 *
 * The returned link is typed with the services the layer provides: `createClient` rejects it
 * when a procedure handler (or a server middleware) of the router is missing.
 */
export const localLink = <Handlers>(options: LocalLinkOptions<Handlers>): Link<Handlers> =>
  make(<Rpcs extends Rpc.Any>(group: RpcGroup.RpcGroup<Rpcs>) =>
    Effect.gen(function* () {
      // The layer provides `Handlers`; `createClient` checks (via `Link<Handlers>`) that it covers
      // `Rpc.ToHandler<Rpcs> | Rpc.Middleware<Rpcs>`, which is not expressible on this generic.
      const context = (yield* Layer.build(
        Layer.orDie(options.handlers),
      )) as unknown as Context.Context<Rpc.ToHandler<Rpcs> | Rpc.Middleware<Rpcs>>;
      let toClient: (message: RpcMessage.FromServer<Rpcs>) => Effect.Effect<void> = () =>
        Effect.void;
      const server = yield* RpcServer.makeNoSerialization(group, {
        disableFatalDefects: true,
        onFromServer: (message) => toClient(message),
      }).pipe(Effect.provideContext(context));
      const { client, write } = yield* RpcClient.makeNoSerialization(group, {
        supportsAck: true,
        onFromClient: ({ message }) => server.write(0, message),
      });
      toClient = write;
      return client;
    }),
  );
