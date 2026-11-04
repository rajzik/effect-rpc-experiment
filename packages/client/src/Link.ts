/**
 * Transports for `createClient`: `httpLink`, `wsLink`, `localLink` and custom `Link`s.
 *
 * A link turns the router's `RpcGroup` into a connected `effect/rpc` `RpcClient`. Network links
 * wrap an `RpcClient.Protocol` (`layerProtocolHttp`, `layerProtocolSocket`) and must match the
 * server's protocol and serialization (`@effect-trpc/server` defaults: HTTP + NDJSON);
 * `localLink` runs the handlers in-process with no serialization.
 *
 * @since 0.1.0
 */
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
 * **When to use**
 *
 * Use as the type of the `link` option. Build one with {@link httpLink}, {@link wsLink},
 * {@link localLink}, or for a custom transport with `Link.make` / `Link.fromProtocol`.
 *
 * **Details**
 *
 * - `makeClient` runs once per `createClient` instance (lazily, on the first call) inside the
 *   client's scope; closing that scope (`client.dispose()`) releases connections, sockets and
 *   in-process servers.
 * - `Handlers` is a type-level marker used by {@link localLink}: it records which server services
 *   (handlers and server middleware) the link provides, so `createClient` can reject a local link
 *   whose handler layer does not implement every procedure of the router. Network links leave it
 *   as `unknown` (compatible with every router).
 *
 * @see {@link httpLink}
 * @see {@link wsLink}
 * @see {@link localLink}
 * @category models
 * @since 0.1.0
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

/**
 * The `RpcSerialization` used by a link: `"ndjson"` (default), `"json"` or a custom layer.
 *
 * **Gotchas**
 *
 * - It must match the server's serialization; with a mismatch calls fail or never complete.
 *   Keep `"ndjson"` for subscriptions over HTTP.
 *
 * @category options
 * @since 0.1.0
 */
export type SerializationOption =
  | 'json'
  | 'ndjson'
  | Layer.Layer<RpcSerialization.RpcSerialization>;

/**
 * Headers for every request of a link: a static value, or a (possibly async) function evaluated
 * once per request (tRPC's `headers()` option).
 *
 * **Details**
 *
 * - Also the type of `createClient({ headers })` and `client.withHeaders(headers)`, where a
 *   function is evaluated once per call.
 * - If the function throws or rejects, the call fails with `RpcTransportError`.
 *
 * @category options
 * @since 0.1.0
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
 * usually `RpcClient.make(group)` with a protocol provided). It runs in the client's scope, so
 * resources acquired with `Effect.acquireRelease` are released by `client.dispose()`.
 */
const make = (makeClient: Link['makeClient']): Link => ({ [TypeId]: TypeId, makeClient });

/**
 * Creates a link from an `RpcClient.Protocol` layer. The layer is built in the client's scope,
 * so its resources (connections, sockets) live until `client.dispose()`. Layer construction
 * errors become defects (`RpcDefect`).
 */
const fromProtocol = <E>(protocol: Layer.Layer<RpcClient.Protocol, E>): Link =>
  make((group) =>
    Effect.gen(function* () {
      const context = yield* Layer.build(Layer.orDie(protocol));
      return yield* RpcClient.make(group).pipe(Effect.provideContext(context));
    }),
  );

/**
 * Link constructors for custom transports: `Link.make(makeClient)` and
 * `Link.fromProtocol(protocolLayer)`.
 *
 * **When to use**
 *
 * Use when none of {@link httpLink}, {@link wsLink} or {@link localLink} fits, e.g. a
 * `MessagePort`, a worker or an `RpcClient.Protocol` you already have. `Link.fromProtocol` is the
 * simple path; `Link.make` gives full control over how the `RpcClient` is created.
 *
 * **Details**
 *
 * - Both run lazily on the client's first call, once per `createClient` instance, inside the
 *   client's scope (released by `client.dispose()`).
 * - Links built this way are typed `Link<unknown>`, so they fit every router.
 *
 * **Example** (An HTTP link with a custom `HttpClient` from `effect/http`)
 *
 * ```ts
 * import { Layer, Schema } from 'effect';
 * import { FetchHttpClient } from 'effect/http';
 * import { RpcClient, RpcSerialization } from 'effect/rpc';
 * import { query, Router } from '@effect-trpc/core';
 * import { createClient, Link } from '@effect-trpc/client';
 *
 * const appRouter = Router.make({ health: query({ success: Schema.Literal('ok') }) });
 *
 * const link = Link.fromProtocol(
 *   RpcClient.layerProtocolHttp({ url: 'http://localhost:3000/rpc' }).pipe(
 *     Layer.provide([FetchHttpClient.layer, RpcSerialization.layerNdjson]),
 *   ),
 * );
 *
 * const client = createClient(appRouter, { link });
 * ```
 *
 * @see {@link httpLink}
 * @category links
 * @since 0.1.0
 */
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

/**
 * Options of {@link httpLink}.
 *
 * @category options
 * @since 0.1.0
 */
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
 * subscriptions work over plain HTTP.
 *
 * **When to use**
 *
 * Use for browsers and servers talking to an `@effect-trpc/server` endpoint (`toWebHandler`,
 * `layerHttp`, `runServer`). Prefer {@link wsLink} for many concurrent subscriptions over one
 * connection and {@link localLink} for in-process calls.
 *
 * **Details**
 *
 * - The server must use `RpcServer.layerHttp` with `protocol: "http"` and the same
 *   serialization (the `@effect-trpc/server` adapters do).
 * - Non-2xx responses and network errors surface as `RpcTransportError`.
 * - `headers` are sent as HTTP headers; a function is evaluated once per request. They reach
 *   server middleware and handlers as `headers`.
 * - `fetch` replaces the global fetch, e.g. to call a `toWebHandler` handler without a network.
 *
 * **Gotchas**
 *
 * - `url` must be absolute `http:` / `https:`; a relative URL like `"/rpc"` throws when the link
 *   is created. In the browser use `new URL('/rpc', location.origin).href`.
 *
 * **Example** (Calling a server with an auth header)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { createClient, httpLink } from '@effect-trpc/client';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post }) },
 * });
 *
 * declare const getToken: () => Promise<string>;
 *
 * const client = createClient(appRouter, {
 *   link: httpLink({
 *     url: 'http://localhost:3000/rpc', // must be absolute
 *     headers: async () => ({ authorization: `Bearer ${await getToken()}` }), // per request
 *   }),
 * });
 *
 * const post = await client.post.byId({ id: 1 }); // a Post instance
 * ```
 *
 * @see {@link HttpLinkOptions}
 * @category links
 * @since 0.1.0
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

/**
 * Options of {@link wsLink}.
 *
 * @category options
 * @since 0.1.0
 */
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
 * closed by `client.dispose()`).
 *
 * **When to use**
 *
 * Use for real-time apps with many concurrent calls and subscriptions. Prefer {@link httpLink}
 * when the server only speaks HTTP (e.g. a `toWebHandler` fetch handler).
 *
 * **Details**
 *
 * - The server must use `RpcServer.layerHttp` with `protocol: "websocket"` and the same
 *   serialization, e.g. `layerHttp(router, { protocol: 'websocket', serialization: 'ndjson' })`
 *   from `@effect-trpc/server`.
 * - Rpc headers (`createClient({ headers })`, per-call `headers`) are sent with each rpc message.
 *
 * **Gotchas**
 *
 * - `url` must be absolute `ws:` / `wss:`; anything else throws when the link is created.
 * - The link defaults to `"ndjson"`, while `layerHttp(..., { protocol: 'websocket' })` defaults to
 *   `"json"`: set the same `serialization` on both sides.
 *
 * **Example** (One WebSocket for every call)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { query, Router, subscription } from '@effect-trpc/core';
 * import { createClient, wsLink } from '@effect-trpc/client';
 *
 * const appRouter = Router.make({
 *   health: query({ success: Schema.Literal('ok') }),
 *   countdown: subscription({ payload: { from: Schema.Number }, success: Schema.Number }),
 * });
 *
 * const client = createClient(appRouter, {
 *   link: wsLink({ url: 'ws://localhost:3000/rpc', serialization: 'json' }),
 * });
 *
 * for await (const n of client.countdown({ from: 3 })) console.log(n);
 * await client.dispose(); // closes the socket
 * ```
 *
 * @see {@link WsLinkOptions}
 * @category links
 * @since 0.1.0
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

/**
 * Options of {@link localLink}.
 *
 * @category options
 * @since 0.1.0
 */
export interface LocalLinkOptions<Handlers> {
  /**
   * The server implementation: the handlers layer (`router.group.toLayer({...})`) merged with the
   * server-side middleware layers. It is built once per client and released by `dispose()`.
   */
  readonly handlers: Layer.Layer<Handlers, unknown>;
}

/**
 * An in-process link: runs the router's handlers in the same process, with no serialization
 * (values are passed by reference).
 *
 * **When to use**
 *
 * Use in tests, SSR and server-side code that should use the client API. Prefer
 * `createCaller` from `@effect-trpc/server` when you do not need the client API.
 *
 * **Details**
 *
 * - Handler defects become `RpcDefect` without breaking later calls; interruption reaches the
 *   handler.
 * - The handler layer is built once per client (on the first call) and released by
 *   `dispose()`. Layer construction errors become defects (`RpcDefect`).
 * - The returned link is typed with the services the layer provides: `createClient` rejects it
 *   when a procedure handler (or a server middleware) of the router is missing.
 *
 * **Example** (Testing against in-process handlers)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { createClient, localLink } from '@effect-trpc/client';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 *
 * // `Handlers.make` from @effect-trpc/server returns the same kind of layer.
 * const handlers = appRouter.group.toLayer({
 *   'post.byId': ({ id }) =>
 *     id === 1 ? Effect.succeed(new Post({ id, title: 'Hello' })) : Effect.fail(new PostNotFound({ id })),
 * });
 *
 * const client = createClient(appRouter, { link: localLink({ handlers }) });
 * const post = await client.post.byId({ id: 1 });
 * await client.dispose(); // releases the handler layer
 * ```
 *
 * @see {@link createClient}
 * @category links
 * @since 0.1.0
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
