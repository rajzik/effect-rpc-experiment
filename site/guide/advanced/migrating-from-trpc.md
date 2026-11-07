# Migrating from tRPC

The shapes are the same: a router of procedures, a typed client mirroring it, TanStack Query options.
What changes is where types come from (Effect Schemas instead of validators plus inference) and how
errors and context work (typed errors and services instead of `TRPCError` and `ctx`).

## Concepts

| tRPC                                         | effect-trpc                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| `initTRPC.create()`, `t.procedure`           | `query`, `mutation`, `subscription` from `@effect-trpc/core`                    |
| `.input(zod)`                                | `payload: { … }` or a schema                                                    |
| output inferred from the resolver            | `success` schema (encoded on the wire, decoded on the client)                   |
| `throw new TRPCError({ code: 'NOT_FOUND' })` | `Effect.fail(new PostNotFound({ id }))`, declared in `error`                    |
| `t.router({ … })`                            | `Router.make({ … })`                                                            |
| resolvers inline in the router               | `Handlers.make(router, { … })` in a server-only module                          |
| `createContext` + `ctx`                      | middleware that `provides` services; `Handlers.withContext`                     |
| `createContext` reading `req`                | `HttpContext.request`, inside `withContext`'s effect or a handler               |
| `ctx.res` headers, cookies, `responseMeta`   | `HttpContext.setHeader`, `appendHeader`, `setCookie` (no status)                |
| `meta`, `.meta({ … })`                       | `.annotate(Key, value)`, read as `Context.get(rpc.annotations, Key)`            |
| `onError({ error, path, input, ctx })`       | `onError({ path, cause, headers })` option of the adapters                      |
| `t.middleware(…)`, `.use(…)`                 | `RpcMiddleware` + `.middleware(M)`                                              |
| `createCallerFactory`                        | `createCaller(router, { handlers })`                                            |
| fetch / standalone adapters                  | `toWebHandler`, `serve` / `runServer`                                           |
| superjson transformer                        | nothing: Effect Schema encodes `Date`, classes, `BigInt`                        |
| `createTRPCClient` + links                   | `createClient(router, { link })`                                                |
| `httpBatchLink`                              | `httpBatchLink` (queries only)                                                  |
| `TRPCClientError`, `error.data.code`         | `ClientError<E>`, narrow on `_tag`                                              |
| `@trpc/tanstack-react-query`                 | `@effect-trpc/tanstack-react-query` ([differences](../react-query/differences)) |
| `@trpc/next`, RSC helpers                    | `@effect-trpc/next`                                                             |

## Step by step

1. **Schemas.** Turn each input validator into a payload schema and each returned type into a
   `success` schema. Domain objects become `Schema.Class`es.
2. **Errors.** For each `TRPCError` code a client branches on, add a `Schema.TaggedError` and declare
   it on the procedure. Everything else becomes a defect.
3. **Context.** Each field of `ctx` becomes a service, provided by middleware (the user, the tenant),
   by `Handlers.withContext` (a request id, anything computed per call) or by the server layer (the
   database). What `createContext` read from `req` is read with `HttpContext.request`; what
   resolvers wrote to `res` is `HttpContext.setHeader` / `setCookie`
   ([request, response, context](../server/http-context)).
4. **Resolvers.** Move them into `Handlers.make`, as Effects. `async` code fits in `Effect.tryPromise`.
5. **Adapter.** Replace the fetch adapter with `toWebHandler` (or `createRouteHandler` in Next.js).
6. **Client.** Replace `createTRPCClient` with `createClient`. `httpBatchLink` keeps its name, with
   the options of `httpLink` plus `maxItems`.
7. **React.** Rename the context hooks; error handling switches from `error.data.code` to
   `error._tag`.

## What you gain

- Errors are part of each procedure's type, so clients handle them exhaustively.
- Class instances (with methods) on the client, without a transformer.
- Handlers compose with the Effect ecosystem: services, layers, retries, streams, tracing.

## What to plan for

- The router value ships to the browser (it holds schemas). Keep it free of server code.
- `httpBatchLink` batches queries only. Mutations and subscriptions get a request each, and the
  calls of a batch share one response, so headers and cookies set by one apply to all.
- `onError` is not called for calls the server rejects before or after running them: a payload that
  fails to decode, an unknown procedure, a success value that fails to encode. They reach the client
  as `RpcDefect`. tRPC's `BAD_REQUEST` input errors do reach `onError`. It also receives `cause`
  and `headers` instead of `error`, `input`, `type` and `ctx`.
- A handler cannot set the HTTP status, so there is no `responseMeta` for status codes.
- See [known limits](./limits).
