/**
 * Request and response access for procedure handlers and middleware: read the HTTP request, set
 * response headers and cookies.
 *
 * When a call arrives over HTTP, `effect/rpc`'s `RpcServer` runs the handler with the HTTP
 * request fiber's context, so Effect's `HttpServerRequest` is available and response changes can
 * be registered with `HttpEffect.appendPreResponseHandler`. These helpers wrap both without adding
 * a requirement, so handlers that use them still run under `createCaller`, `localLink`, Electron
 * and tests (there they read `None` and valid setter calls do nothing).
 *
 * @since 0.1.0
 */
import { Effect, Option } from 'effect';
import { Cookies, Headers, HttpEffect, HttpServerRequest, HttpServerResponse } from 'effect/http';

/**
 * The HTTP request of the current call: `Some` when it arrived over HTTP, `None` otherwise.
 *
 * **Details**
 *
 * - Over WebSocket it is the upgrade request (shared by every call of the connection).
 * - `None` under `createCaller`, `localLink`, Electron and the test harness.
 *
 * **Example** (Reading a header)
 *
 * ```ts
 * import { Effect, Option, Schema } from 'effect';
 * import { HttpContext, Procedure } from '@rpc-effect/core';
 *
 * const userAgent = Procedure.output(Schema.String).query(() =>
 *   Effect.map(
 *     HttpContext.request,
 *     Option.match({
 *       onNone: () => 'unknown',
 *       onSome: (request) => request.headers['user-agent'] ?? 'unknown',
 *     }),
 *   ),
 * );
 * ```
 *
 * @category getters
 * @since 0.1.0
 */
const request: Effect.Effect<Option.Option<HttpServerRequest.HttpServerRequest>> =
  Effect.serviceOption(HttpServerRequest.HttpServerRequest);

// Over WebSocket every call shares the upgrade request, whose response is long gone: registering
// would only grow its pre-response handler chain for the lifetime of the connection. The server's
// `protocol` is the authority on the transport; this header sniff is only a guard.
const isWebSocketUpgrade = (req: HttpServerRequest.HttpServerRequest): boolean =>
  req.headers.upgrade?.toLowerCase() === 'websocket';

const onResponse = (
  update: (
    response: HttpServerResponse.HttpServerResponse,
  ) => HttpServerResponse.HttpServerResponse,
): Effect.Effect<void> =>
  Effect.flatMap(request, (option) =>
    Option.isNone(option) || isWebSocketUpgrade(option.value)
      ? Effect.void
      : Effect.provideService(
          HttpEffect.appendPreResponseHandler((_, response) => Effect.succeed(update(response))),
          HttpServerRequest.HttpServerRequest,
          option.value,
        ),
  );

// The characters Node's `http` and fetch `Headers` accept (RFC 9110 token / field value).
const headerName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const headerValue = /^[\t\x20-\x7e\x80-\xff]*$/;

// Checked up front: an invalid header would otherwise break the whole HTTP response later.
const checkHeader = (name: string, value: string): Effect.Effect<void> =>
  headerName.test(name) && headerValue.test(value)
    ? Effect.void
    : Effect.die(
        new TypeError(`HttpContext: invalid characters in the name or value of header "${name}"`),
      );

/**
 * Sets a response header, replacing any value set before.
 *
 * **Details**
 *
 * - Header names are case-insensitive (stored lowercased).
 * - Dies (a defect) when the name or value has characters not allowed in an HTTP header (e.g.
 *   CR/LF), even outside HTTP.
 * - A valid call is a no-op when the call did not arrive over HTTP, or arrived over WebSocket.
 *
 * **Example** (Disabling caching)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { HttpContext, Procedure } from '@rpc-effect/core';
 *
 * const now = Procedure.output(Schema.Finite).query(() =>
 *   HttpContext.setHeader('cache-control', 'no-store').pipe(Effect.as(Date.now())),
 * );
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
const setHeader = (name: string, value: string): Effect.Effect<void> =>
  Effect.andThen(checkHeader(name, value), onResponse(HttpServerResponse.setHeader(name, value)));

/**
 * Appends a value to a response header, keeping the values set before (`a, b`).
 *
 * **Details**
 *
 * - Validated, and a no-op outside HTTP, like {@link setHeader}.
 *
 * **Example** (Adding to `vary`)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { HttpContext, Procedure } from '@rpc-effect/core';
 *
 * const greeting = Procedure.output(Schema.String).query(() =>
 *   HttpContext.appendHeader('vary', 'accept-language').pipe(Effect.as('hello')),
 * );
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
const appendHeader = (name: string, value: string): Effect.Effect<void> =>
  Effect.andThen(
    checkHeader(name, value),
    onResponse((response) =>
      HttpServerResponse.setHeader(
        response,
        name,
        Option.match(Headers.get(response.headers, name), {
          onNone: () => value,
          onSome: (previous) => `${previous}, ${value}`,
        }),
      ),
    ),
  );

/**
 * Sets a response cookie (a `set-cookie` header).
 *
 * **Details**
 *
 * - Dies (a defect) on an invalid name, value or option, even outside HTTP.
 * - A valid call is a no-op when the call did not arrive over HTTP, or arrived over WebSocket.
 *
 * **Example** (A login mutation setting a session cookie)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { HttpContext, Procedure } from '@rpc-effect/core';
 *
 * const login = Procedure.input({ token: Schema.String }).mutation(({ token }) =>
 *   HttpContext.setCookie('session', token, { httpOnly: true, secure: true, path: '/' }),
 * );
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
const setCookie = (
  name: string,
  value: string,
  options?: Cookies.Cookie['options'],
): Effect.Effect<void> =>
  Effect.flatMap(
    Effect.orDie(Effect.fromResult(Cookies.makeCookie(name, value, options))),
    (cookie) => onResponse(HttpServerResponse.updateCookies(Cookies.setCookie(cookie))),
  );

/**
 * Reads the HTTP request of the current call and sets response headers and cookies, from a
 * procedure handler or a middleware.
 *
 * **When to use**
 *
 * Use to read request data that is not part of the rpc payload (a header, the client address, a
 * cookie) or to change the HTTP response — e.g. a `login` mutation that sets a session cookie.
 * Prefer a middleware that `provides` a service (e.g. `CurrentUser`) when many procedures need
 * the same value derived from the request.
 *
 * **Details**
 *
 * | API                                       | Description                                          |
 * | ----------------------------------------- | ---------------------------------------------------- |
 * | `HttpContext.request`                     | `Option<HttpServerRequest>` of the current call.     |
 * | `HttpContext.setHeader(name, value)`      | Sets a response header (replaces earlier values).    |
 * | `HttpContext.appendHeader(name, value)`   | Appends to a response header (`a, b`).               |
 * | `HttpContext.setCookie(name, value, opt)` | Sets a cookie; `opt` is `Cookies.Cookie['options']`. |
 *
 * - None of them adds a requirement or an error: they are `Effect<…, never, never>`, so a
 *   handler using them still runs under every transport.
 * - Outside HTTP (`createCaller`, `localLink`, Electron, tests) `request` is `None` and valid
 *   setter calls do nothing. Invalid input (a header with CR/LF, a cookie name with a space) dies
 *   everywhere: a defect, `RpcDefect` on the client.
 * - Changes apply to the response when it is written, in call order.
 *
 * **Gotchas**
 *
 * - With a framed serialization (`ndjson`, the default) the response is written as soon as the
 *   first response chunk exists: the `Exit` of a query or mutation, the first element of a
 *   subscription. Headers and cookies set after that (e.g. by a subscription after its first
 *   element) are silently dropped. With `serialization: 'json'` the whole response is collected
 *   first, so they apply until the last call of the request ends.
 * - Several calls sent in one HTTP request share one response: a header set by one of them
 *   applies to all, and (framed) only if set before the first of them writes its response chunk.
 * - A setter registers a hook on the request that lives until the response is written. A
 *   subscription calling one for every element keeps growing that chain for as long as it
 *   streams (with `serialization: 'json'` the chain runs once, at the end): set headers once, up
 *   front, not per element.
 * - Over WebSocket, `request` is the upgrade request and the setters do nothing (the upgrade
 *   response was sent before any call).
 * - `appendHeader` joins values with `", "`; use `setCookie` for cookies, never
 *   `appendHeader('set-cookie', …)`.
 *
 * **Example** (A login mutation that reads a header and sets a cookie)
 *
 * ```ts
 * import { Effect, Option, Schema } from 'effect';
 * import { HttpContext, Procedure, Router } from '@rpc-effect/core';
 *
 * const appRouter = Router.make({
 *   login: Procedure.input({ token: Schema.String }).mutation(({ token }) =>
 *     Effect.gen(function* () {
 *       const request = yield* HttpContext.request;
 *       const agent = Option.match(request, {
 *         onNone: () => 'local',
 *         onSome: (req) => req.headers['user-agent'] ?? 'unknown',
 *       });
 *       yield* HttpContext.setHeader('x-login-agent', agent);
 *       yield* HttpContext.setCookie('session', token, { httpOnly: true, path: '/' });
 *     }),
 *   ),
 * });
 * ```
 *
 * @category combinators
 * @since 0.1.0
 */
export const HttpContext = {
  request,
  setHeader,
  appendHeader,
  setCookie,
} as const;
