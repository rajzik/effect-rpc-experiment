# tRPC parity: HTTP context, request context, meta, onError, batching — design

Date: 2026-11-06. Branch `t3/trpc-parity-http-context`, stacked on PR #7 (router services whose
`make` reads services).

## Intent

A gap audit against tRPC v11 found that context works (middleware `provides` services) but three
pieces are missing, plus several server/client features. The user asked to do, in order:

1. Request and response access from handlers and middleware (read the request; set response
   headers and cookies — e.g. a `login` mutation setting a session cookie).
2. A request-level context option on the HTTP adapters (tRPC's `createContext`).
3. Procedure `meta` and a server `onError` hook.
4. HTTP batching (`httpBatchLink`).

## Facts verified against effect@4.0.1 (drive the design)

> Revised after review (2026-11-07): the lockfile now pins effect@4.0.7. Since 4.0.6
> `RpcClient.makeProtocolHttp(client, { batch })` batches HTTP requests, and pre-response handlers
> live in the request state of the fiber context (`appendPreResponseHandlerUnsafe(context, …)`).
> The request context became `Handlers.withContext` instead of a `context` option (goal 2 below).

- `RpcServer` runs `write` in the HTTP request fiber and forks each handler with
  `Context.merge(handlerLayerContext, requestFiberContext)`. So a handler (and its middleware) served
  over HTTP already sees Effect's `HttpServerRequest` (probe: `toWebHandler` handler read
  `POST /rpc?x=1`).
- `HttpEffect.appendPreResponseHandler` registers per-request response hooks in a WeakMap keyed by
  the request source; called from a handler, it changed the HTTP response (probe: `x-probe: yes`).
- The HTTP protocol returns the response once the first response chunk exists: for a query or
  mutation that is its `Exit`; for a subscription, the first element.
- The server already accepts several rpc request messages in one POST body and streams their
  responses back (NDJSON) in completion order. `RpcClient`'s HTTP protocol sends one POST per call.
- `RpcServer` reports failed handler exits through `ErrorReporter`, but without the procedure tag.
- A link's `makeClient(group)` receives the `RpcGroup`; each rpc carries the `ProcedureKind`
  annotation.

## Goals

1. `HttpContext` in `@effect-trpc/core` (core, because router-service handlers ship to the client and
   must not import `@effect-trpc/server`), no requirements in `R`:
   - `HttpContext.request: Effect<Option<HttpServerRequest>>` — `Some` when the call arrived over HTTP
     (or a WebSocket upgrade request), `None` for `createCaller`, `localLink`, Electron, tests.
   - `HttpContext.setHeader(name, value)`, `appendHeader(name, value)`,
     `setCookie(name, value, options?)`: `Effect<void>`, register a pre-response handler on the
     current HTTP request; no-ops when there is none.
2. `Handlers.withContext(handlers, context)` in `@effect-trpc/server`, applied by every HTTP adapter
   (`layerHttp`, `toWebHandler`, `serve` / `runServer`, Next `createRouteHandler`, Start
   `createStartHandler`): `context: Effect<Context<C>, never, CR>` is evaluated per call before
   middleware and handler; its services are provided to the call. The returned layer no longer
   requires `C` (handlers may `yield*` it); `CR` comes from the output of `handlers`.
3. `meta`: `.annotate(key, value)` on the `Procedure` builder and on `query/mutation/subscription`
   definitions, carried into the compiled rpc (`rpc.annotate`). Middleware reads it with
   `Context.get(rpc.annotations, Key)` (or `getOption`). Keys are ordinary `Context.Key`s /
   `Context.Reference`s (a `Reference` gives a default for procedures that don't set it).
4. `onError` option on the same server options:
   `onError?: (error: { readonly path: string; readonly cause: Cause<unknown>; readonly headers: Headers }) => Effect<void>`,
   called for every call that fails (typed failure or defect, including middleware failures; not
   interruption), before the failure is sent.
5. `httpBatchLink(options)` in `@effect-trpc/client`: options of `httpLink` plus
   `maxItems?: number` (default unlimited). Queries issued in the same tick go in one POST;
   mutations and subscriptions are sent alone (one POST each, as `httpLink`). Responses are
   dispatched per request id as they stream back. Built on effect/rpc's batching HTTP protocol (a
   1 ms window, `maxSize = maxItems`) for queries and its unbatched one for the rest.

## Non-goals

- Setting the HTTP status from a handler (non-2xx breaks the rpc protocol on the client).
- `withContext` / `onError` for `createCaller`, `localLink`, Electron or the test harness (their handler
  layers can be provided directly; revisit if asked).
- Router-level `.annotate` (procedure level only); a typed `initTRPC.meta<M>()` equivalent.
- GET queries / HTTP caching (item 4 alternative not chosen, see Approaches).
- Cancelling the calls of a batch on the server: a batch POST is never aborted for its callers
  (`client.dispose()` aborts the open ones).

## Anti-goals

- A handler that reads `HttpContext` must not gain a requirement (`R`) — it would break every
  non-HTTP transport at the type level.
- `context` must not make the client router module import server code.
- Batching must not change typed errors, decoding, or which middleware runs.
- A header/cookie set by one call of a batch must not silently go missing without the docs saying so.

## Approaches

| Item | Picked                                                                                                                                    | Rejected                                                  | Why                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Expose Effect's `HttpServerRequest` / pre-response handlers via `HttpContext` (serviceOption, no R)                                       | Our own request registry correlated by an injected header | The request fiber context already reaches handlers; a header registry is spoofable and duplicates Effect                                      |
| 1    | Helpers in core                                                                                                                           | Helpers in server                                         | Router-service handlers live in the shared router module                                                                                      |
| 2, 4 | An internal server-only middleware added to the served group in `layerHttp` (outermost: added last), implementing `context` and `onError` | Wrapping handlers in `Handlers.*`                         | Users also build handlers with `router.group.toLayer`; the middleware sees every call, its `rpc` and `headers`, and inner middleware failures |
| 2    | `context: Effect<Context<C>, never, CR>`                                                                                                  | A per-request `Layer`; a function of the request          | A per-request layer rebuilds shared deps; the request is read with `HttpContext.request` inside the effect (one way)                          |
| 3    | `.annotate(Key, value)` (Effect annotations)                                                                                              | A typed `.meta({...})` object                             | Effect's annotation keys are typed per key, already on `Rpc`, and the parity doc points at them                                               |
| 4    | Client-side `httpBatchLink` (server unchanged)                                                                                            | GET queries for HTTP caching                              | The server already accepts multi-message bodies; GET needs a second server route and client protocol, and the deferred parity row is batching |

## Design notes

- Internal middleware: a `RpcMiddleware` service private to `@effect-trpc/server`, always added with
  `group.middleware(Hooks)` to the group passed to `RpcServer` inside `layerHttp`. Its layer reads
  the internal `RequestContext` service that `Handlers.withContext` adds to the handlers layer
  (`Effect.serviceOption`); that service already carries what `context` needs (`CR`). Order: added
  last, so it wraps every user middleware (user middleware sees the `context` services; `onError`
  sees their failures). Over WebSocket it runs per call too.
- Typing: `Handlers.withContext` returns `Layer<Out, E, Exclude<R, C> | Exclude<CR, Out>>` (its one
  cast); the adapters have no context generics. A handler that `yield*`s a `context` service
  compiles with `toWebHandler(router, { handlers: Handlers.withContext(handlers, context) })` and
  fails to compile without it.
- `HttpContext.setCookie` uses `HttpServerResponse.setCookie` (check its v4 signature; an invalid
  cookie is a defect).
- Batching and headers: one batch shares one HTTP response. Headers/cookies set by any call in the
  batch apply to it, but only if set before the first response chunk is written (the fastest call
  finishing). Mutations are not batched, so a `login` mutation's cookie is always applied. Documented
  as a gotcha on `HttpContext` and `httpBatchLink`.
- Batching and abort: aborting one call completes it on the client as interrupted; the server keeps
  running it until the batch request ends. The batch request is not aborted even when every call of
  it is (effect/rpc runs batches in the client's scope); `client.dispose()` aborts it.
- Docs: new guide sections (server: request & response; context option; meta; onError; client:
  batching), update `limits.md`, `migrating-from-trpc.md`, `docs/trpc-test-parity*.md`
  (batching row → ported; meta/responseMeta rows point at the new APIs), READMEs incl. `## For AI agents`,
  JSDoc with compiling examples.

## Left to the builder

- Internal names (the hooks middleware, the batch protocol).
- Batch protocol internals (tick scheduling, response routing), within the semantics above.
