# Known limits

What effect-trpc does not do (yet), and what to do instead.

| Limit                                                               | Instead                                                              |
| ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `httpBatchLink` batches queries, not mutations or subscriptions     | one POST each, as `httpLink`                                         |
| Headers a batched query sets apply to its whole batch               | `httpLink`, or set them from a mutation (never batched)              |
| Aborting a batched query does not stop it on the server             | `httpLink` for long queries you abort; `client.dispose()` stops all  |
| Headers and cookies are written with the first response chunk       | set them once, before the first stream element                       |
| A handler cannot set the HTTP status                                | typed errors; non-2xx is a transport failure on the client           |
| `withContext` and `onError` apply on the HTTP adapters only         | provide services to the handlers of `createCaller` / `localLink`     |
| `onError` skips invalid payloads, unknown procedures, encode errors | they reach the client as `RpcDefect` (tRPC reports `BAD_REQUEST`)    |
| Links don't reconnect subscriptions; no `tracked()` / `lastEventId` | `sub.reset()` on error; resume from your own cursor in the input     |
| Streamed (async-iterable) query results                             | a subscription                                                       |
| The router value (schemas) ships to the browser                     | keep the router module free of server code                           |
| Serverless functions cut long-lived subscriptions                   | a long-running server for WebSockets / streams                       |
| A Next.js query that fails while streaming loses its class          | `await` the prefetch on pages that show typed errors                 |
| A TanStack Start loader that throws loses the error's class         | `prefetchQuery` in the loader, narrow `query.error` in the component |
| `@tanstack/react-router-ssr-query` is untested with Start hydration | avoid running rpc data through both serializers                      |
| Next.js dev mode: HMR creates a new server per re-evaluation        | restart the dev server if a layer holds scarce resources             |

## Defaults worth knowing

- Serialization is `ndjson` everywhere (HTTP and WebSocket, server and client). A client using
  `json` against a default server fails.
- Middleware added later runs first.
- `HttpContext` setters do nothing outside HTTP (and over a WebSocket); invalid input dies
  everywhere.
- Servers always run with `disableFatalDefects: true`.
- Clients connect lazily, on the first call.

## What the tests cover, and what they do not

The adapters are unit-tested with Web `Request`s, jsdom, React Testing Library and a real TanStack
router, and each one also runs inside a real app, driven by Playwright against the production build
(see [`examples/`](https://github.com/rajzik/effect-rpc-experiment/tree/main/examples)):

- **Next.js**: `next start`, Chromium.
- **TanStack Start**: the built output served by `vp preview` (the Vite preview server), Chromium.
  Start has no standalone Node server without an extra dependency, so a real deployment target is
  not exercised.
- **Electron**: the built main process, preload and renderer, launched with Playwright's
  `_electron`. On Linux CI the OS-level renderer sandbox state is not asserted (Electron reports it
  only on macOS and Windows).

Not covered: other browsers (Chromium only), serverless platforms, and production deployments of
Start. Report issues you find in a real app.
