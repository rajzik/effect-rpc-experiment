# Serving over HTTP

Pick the adapter by where the server runs. All of them take the same `handlers` layer and the same
options, and all run `effect/rpc`'s `RpcServer` with `protocol: "http"` (unless you ask for a
WebSocket) and `disableFatalDefects: true`.

| Where                                                     | Adapter                                      | Returns                           |
| --------------------------------------------------------- | -------------------------------------------- | --------------------------------- |
| a fetch runtime: Next.js, Start, Bun, Deno, Workers, Hono | `toWebHandler(router, options)`              | `Promise<{ handler, dispose }>`   |
| a standalone Node process                                 | `serve(router, options)` from `/node`        | `Layer`                           |
| tests and scripts on Node                                 | `runServer(router, options)` from `/node`    | `Promise<{ url, port, dispose }>` |
| one route of an Effect HTTP app, or a WebSocket endpoint  | `layerHttp(router, options)` (`toHttpLayer`) | `Layer` needing `HttpRouter`      |

## Fetch handler

<<< @/snippets/server/serving.ts#web

The handler layer is built eagerly: the promise rejects if it fails to build. One layer serves every
request until `dispose()`.

## Node

<<< @/snippets/server/serving.ts#node

`@effect/platform-node` is an optional peer of `@effect-trpc/server`: only `@effect-trpc/server/node`
imports it, and the main entry stays platform-neutral.

## Inside an Effect HTTP app

<<< @/snippets/server/serving.ts#layer

## WebSocket endpoint

<<< @/snippets/server/serving.ts#websocket

Clients connect with [`wsLink`](../client/links#websocket).

## Options

| Option                    | Default       | Applies to            | Notes                                                                                     |
| ------------------------- | ------------- | --------------------- | ----------------------------------------------------------------------------------------- |
| `handlers`                | required      | all                   | handlers plus middleware implementations, no requirements left (optional for `layerHttp`) |
| `path`                    | `"/rpc"`      | all                   | must equal the pathname requests arrive at, else `404`                                    |
| `serialization`           | `"ndjson"`    | all                   | must match the client: see [serialization](./serialization)                               |
| `concurrency`             | `"unbounded"` | all                   | maximum requests handled at once                                                          |
| `disableTracing`          | `false`       | all                   | turns off the spans `RpcServer` creates per request                                       |
| `spanPrefix`              | —             | all                   | prefix of those span names                                                                |
| `context`                 | —             | all                   | per-call services: [request context](./http-context#request-context)                      |
| `onError`                 | —             | all                   | failed-call hook: [report failures](./http-context#report-failures)                       |
| `protocol`                | `"http"`      | `layerHttp`           | `"websocket"` for `wsLink`                                                                |
| `port`, `host`            | —             | `serve`, `runServer`  | port `0` picks a free port                                                                |
| `gracefulShutdownTimeout` | 20s / 1s      | `serve` / `runServer` | how long shutdown waits before interrupting requests                                      |

::: warning Gotchas

- `path` is the full pathname. A Next.js route at `app/api/rpc/[[...rpc]]/route.ts` needs
  `path: "/api/rpc"`.
- `dispose()` interrupts in-flight requests (their `Exit` is an interruption) and runs the layer's
  finalizers. Later requests answer `503`.
- Clients need an absolute URL: `http://localhost:3000/rpc`, not `/rpc`.

:::

See also: [`toWebHandler`](/api/server#towebhandler), [`layerHttp`](/api/server#layerhttp),
[`serve`](/api/server-node#serve), [`runServer`](/api/server-node#runserver).
