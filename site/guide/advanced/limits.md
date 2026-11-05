# Known limits

What effect-trpc does not do (yet), and what to do instead.

| Limit                                                               | Instead                                                              |
| ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| No HTTP batching: each call is one request                          | `wsLink` for many small calls; or a procedure that returns more      |
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
- Servers always run with `disableFatalDefects: true`.
- Clients connect lazily, on the first call.

## Not covered by this project's tests

The Next.js, TanStack Start and Electron adapters are tested with Web `Request`s, jsdom, React
Testing Library and a real TanStack router, not inside running Next.js, Start or Electron apps.
Report issues you find in a real app.
