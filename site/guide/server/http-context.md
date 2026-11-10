# Request, response and context

tRPC hands every resolver a `ctx` built by `createContext(req, res)`. effect-trpc splits that up.
`HttpContext` adds no requirement to a handler, so the same handlers still run under
`createCaller`, `localLink`, Electron and tests. The services of a request context are handler
requirements: over HTTP and under `createCaller` `Handlers.withContext` provides them, elsewhere
provide them with a layer:

| You want to                                 | Use                                                  |
| ------------------------------------------- | ---------------------------------------------------- |
| read a header, the client address, a cookie | `HttpContext.request`                                |
| set a response header or cookie             | `HttpContext.setHeader`, `appendHeader`, `setCookie` |
| provide services computed for every call    | `Handlers.withContext(handlers, context)`            |
| log or report failed calls in one place     | the `onError` option of the HTTP adapters            |
| derive a service that may reject (the user) | [middleware](./middleware), as before                |

## Read the request

<<< @/snippets/server/http-context.ts#request

`HttpContext.request` is an `Option` of Effect's `HttpServerRequest`. It is `Some` when the call
arrived over HTTP, and `None` under `createCaller`, `localLink`, Electron and the test harness. Over
a WebSocket it is the upgrade request, shared by every call of the connection.

## Set headers and cookies

<<< @/snippets/server/http-context.ts#login

| Helper                             | Effect                                                  |
| ---------------------------------- | ------------------------------------------------------- |
| `setHeader(name, value)`           | sets a response header, replacing an earlier value      |
| `appendHeader(name, value)`        | appends to it (`a, b`)                                  |
| `setCookie(name, value, options?)` | sets a cookie; `options` is `Cookies.Cookie['options']` |

They run in a handler or a middleware, and apply to the response when it is written, in call order.
Outside HTTP a valid call does nothing. An invalid header (CR/LF in a name or value) or cookie is a
defect everywhere, so it reaches the client as `RpcDefect` instead of breaking the response.

The HTTP status is not settable: a non-2xx response is a transport failure to the client.

## Request context

`Handlers.withContext(handlers, context)` is tRPC's `createContext`. `context` is an `Effect` of
services, evaluated once per call before every middleware and the handler, and its services are
provided to both.

<<< @/snippets/server/http-context.ts#context

- Handlers may `yield*` the services of `context`. `withContext` removes them from the
  requirements of the handlers layer, so the adapter accepts it. Without it, `RequestId` is an
  unmet requirement and does not compile.
- User middleware runs inside `context`, so it can `yield*` those services too.
- What `context` itself needs (`Effect<Context<C>, never, CR>`) comes from the output of the
  handlers layer you pass: merge the layers it needs into it. What that does not provide stays a
  requirement of the layer `withContext` returns.
- It runs per call over a WebSocket too, where `HttpContext.request` is the upgrade request.
- It cannot fail with a typed error. To reject a call, use a middleware, whose error is part of the
  procedure's errors. A defect in `context` fails the call with `RpcDefect`.

Every HTTP adapter applies it, with the same meaning: `toWebHandler` and `layerHttp` from
`@rpc-effect/server`, `serve` and `runServer` from `@rpc-effect/server/node`, `createRouteHandler`
from `@rpc-effect/next` and `createStartHandler` from `@rpc-effect/start`. `createCaller` applies
it too, with `HttpContext.request` as `None`. `localLink` does not: give it the handlers layer with
the services provided directly, since with a `withContext` layer the calls needing them die.

Prefer middleware when the value depends on who is calling and can be refused (the session). Use
`context` for what every call needs regardless: a request id, a per-request logger, a clock.

## Report failures

`onError` is tRPC's `onError`, for logging and error tracking.

<<< @/snippets/server/http-context.ts#onError

It receives `{ path, cause, headers }`: the procedure path (`"post.byId"`), the full `Cause` (typed
failures are `Fail` reasons, defects `Die` reasons) and the call's headers, request headers
included. It is called once for each call that fails while it runs, whether in the handler or in
a middleware, and before the failure is sent. A subscription that fails mid-stream is reported too.

Rpc message headers, which the client sets, override HTTP request headers of the same name: read a
header set by a trusted proxy from `HttpContext.request`.

It is not called for:

- calls the server rejects outside the handler and middleware: a payload that fails to decode, an
  unknown procedure, a success value that fails to encode. They reach the client as `RpcDefect`.
  This differs from tRPC, whose `BAD_REQUEST` input errors do reach `onError`;
- interruptions (the client aborted, the server shut down).

::: warning Gotchas

- Headers and cookies are written with the first response chunk. With the default `ndjson` that is
  the `Exit` of a query or mutation and the first element of a subscription, so a subscription
  that sets a header after its first element is silently ignored. With `serialization: 'json'` the
  whole response is collected first, so they apply until the last call of the request ends.
- A subscription that calls a setter for every element keeps growing the per-request hook chain
  for as long as it runs (with `json` it runs once, at the end). Set headers once, up front.
- Calls sent in one HTTP request share one response: a header set by one of them applies to all.
  This matters for [batching](../client/batching).
- Over a WebSocket the setters do nothing: the upgrade response was sent before any call.
- `appendHeader` joins values with `", "`. Never use it for `set-cookie`; use `setCookie`.
- `onError` is awaited and is not interrupted, not even by a client abort. A slow hook delays the
  response and a hanging one blocks `dispose()` for that call: fork long work. Failures of the hook
  itself are ignored and never change the response.
- The services of `context` exist only while a call runs: reading them while the handlers layer is
  built fails.

:::

See also: [`HttpContext`](/api/core#httpcontext), [`Handlers`](/api/server#handlers),
[`ServerOptions`](/api/server#serveroptions),
[`OnErrorInfo`](/api/server#onerrorinfo), [Middleware and context](./middleware).
