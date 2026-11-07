# Introduction

effect-trpc is a tRPC-style RPC layer for [Effect](https://effect.website) v4. You declare
procedures once, with Effect Schemas for the input, the output and the errors. The server
implements them as Effects and Streams. Clients call them as Promises, as Effects, or through
TanStack Query, and every call is typed end to end.

It is built on `effect/rpc`. A router compiles to an ordinary `RpcGroup`, and the transports are
`RpcServer` and `RpcClient`, so anything `effect/rpc` supports keeps working: protocols,
serialization formats, `RpcMiddleware`, `RpcTest`.

## What you get

- **Typed errors.** A procedure's `Schema.TaggedError` union arrives on the client as instances of
  your classes. Network failures, defects and cancellation are three separate error types, so they
  are never confused with your domain errors. See [the error model](./concepts/errors).
- **Real instances, not JSON.** `Schema.Class` values (with their `Date` fields, getters and methods)
  are decoded on the client, during SSR hydration and in server-action results.
- **The tRPC developer experience.** Nested routers, `client.post.byId({ id })`,
  `rpc.post.byId.queryOptions(...)`, query keys and filters you already know.
- **Effect all the way down.** Handlers are Effects with services, layers and middleware. The
  Effect client returns Effects with no requirements and an exact error channel.

## Packages

| Package                             | Use it to                                                              |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `@effect-trpc/core`                 | declare procedures and routers; the shared error model and JSON codecs |
| `@effect-trpc/server`               | implement handlers; serve them (fetch handler, `effect/http`); callers |
| `@effect-trpc/server/node`          | run a Node HTTP server                                                 |
| `@effect-trpc/client`               | call procedures from TypeScript: Promise and Effect clients, links     |
| `@effect-trpc/tanstack-react-query` | use procedures in React with TanStack Query                            |
| `@effect-trpc/next`                 | Next.js App Router: route handler, RSC prefetch, server actions        |
| `@effect-trpc/start`                | TanStack Start: server route, isomorphic client, loaders               |
| `@effect-trpc/electron`             | Electron: server in the main process, client in a renderer             |
| `@effect-trpc/test-utils`           | test against a real server (Vitest helpers)                            |

## How it maps

| tRPC                                 | effect-trpc                                      | `effect/rpc` underneath               |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------- |
| `t.procedure.input(z…).query(fn)`    | `query({ payload, success, error })` + a handler | `Rpc.make(tag, …)`                    |
| `t.router({ … })`                    | `Router.make({ … })`                             | `RpcGroup.make(…)`, tag `"post.byId"` |
| resolver function                    | `Handlers.make(router, { post: { byId } })`      | `group.toLayer(…)`                    |
| `TRPCError`                          | your `Schema.TaggedError` + `ClientError<E>`     | typed `Exit` failures                 |
| middleware + `ctx`                   | `RpcMiddleware` that `provides` services         | `RpcMiddleware`                       |
| `createContext`                      | `Handlers.withContext(handlers, context)`        | —                                     |
| fetch adapter                        | `toWebHandler(router, { handlers })`             | `RpcServer.layerHttp`                 |
| `createTRPCClient` + `httpBatchLink` | `createClient(…, { link: httpBatchLink(…) })`    | `RpcClient` + a protocol              |
| `@trpc/tanstack-react-query`         | `@effect-trpc/tanstack-react-query`              | —                                     |
| superjson transformer                | Effect Schema (nothing to configure)             | `RpcSerialization`                    |

## Requirements

- Effect v4 (`effect@^4`). The APIs follow v4: `Context.Service`, `effect/rpc`, `effect/http`,
  `Schema.TaggedError`. Effect v3 snippets do not apply.
- Node 22.18 or later, or any runtime with `fetch` and Web Streams for the client.
- TypeScript with `strict` on. The packages are ESM only.

Next: [install the packages](./installation), then follow the [quick start](./quick-start).
