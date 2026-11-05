# Routers and procedures

A procedure is a description: its kind, its schemas and its middleware. A router is a nested record
of procedures. `Router.make` compiles the record into an `effect/rpc` `RpcGroup` whose tags are the
dot-joined paths (`"post.byId"`).

## Procedure kinds

| Constructor    | Meaning                         | Handler returns | Promise client returns |
| -------------- | ------------------------------- | --------------- | ---------------------- |
| `query`        | a read, safe to cache and retry | `Effect<A, E>`  | `Promise<A>`           |
| `mutation`     | a write                         | `Effect<A, E>`  | `Promise<A>`           |
| `subscription` | a stream of values              | `Stream<A, E>`  | `AsyncIterable<A>`     |

All three take the same options:

| Option    | Default        | Notes                                                            |
| --------- | -------------- | ---------------------------------------------------------------- |
| `payload` | `Schema.Void`  | struct fields (`{ id: Schema.Finite }`) or any schema            |
| `success` | `Schema.Void`  | for a subscription, the schema of one element                    |
| `error`   | `Schema.Never` | usually a `Schema.TaggedError` class or a `Schema.Union` of them |

The kind matters to adapters: TanStack Query gets `queryOptions` for queries and `mutationOptions`
for mutations, and Next.js server actions are mutations. On the wire, every kind is an `effect/rpc`
request; subscriptions compile to `Rpc.make(tag, { stream: true })`.

## Nesting

<<< @/snippets/concepts/routers.ts#nesting

Records and routers nest to any depth. The client mirrors the shape: `client.admin.stats.count()`.

## Inspecting a router

<<< @/snippets/concepts/routers.ts#inspect

`router.procedures` lists each procedure's `path`, `tag`, `kind` and compiled `rpc` in definition
order. A compiled rpc also carries its kind as an annotation:
`Context.get(rpc.annotations, ProcedureKind)` is `"query"`, `"mutation"` or `"subscription"`. `router.group` is a plain `RpcGroup`: hand it to `RpcServer`, `RpcClient` or `RpcTest`
directly when you need something effect-trpc does not wrap.

## Middleware on procedures and routers

<<< @/snippets/concepts/routers.ts#middleware

A middleware's `error` is added to the error type of every procedure it is attached to, and
`inferError` includes it. Middleware added later wraps the middleware added before it, so it runs
first. The server side of middleware is covered in [Middleware and context](../server/middleware).

## Merging routers

<<< @/snippets/concepts/routers.ts#merge

## Reserved keys

<<< @/snippets/concepts/routers.ts#reserved

| Where                     | Reserved                                                    | Why                                                         |
| ------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| any level (`Router.make`) | `then`, `call`, `apply`; keys containing `.`; the empty key | a proxy with `then` is awaited as a Promise; `.` joins tags |
| client root               | `$effect`, `$router`, `withHeaders`, `dispose`              | client methods (`createClient` throws)                      |
| caller root               | `$promise`, `$router`, `dispose`                            | caller methods (`createCaller` throws)                      |

Keys such as `toJSON`, `toString` or `constructor` are allowed. Every proxy (client, caller,
TanStack options) resolves a declared path first, so a procedure named `toJSON` is callable. When a
key is not declared, introspection keys return `undefined`, so a proxy is never mistaken for a
thenable or a React element. The shared rule is
[`Router.childPath`](/api/core#router-childpath).

::: warning Gotchas

- The router module is imported by the client. Keep handlers, databases and secrets out of it:
  put them in the server implementation (`Handlers.make`).
- `Router.merge` throws when both routers have the same top-level key. Nest one of them instead.
- Renaming a key renames the tag, and so the wire format. Old clients calling the old tag fail
  with `RpcDefect`.

:::

See also: [`query`](/api/core#query), [`Router`](/api/core#router),
[`Router.make`](/api/core#router-make), [`ProcedureDef`](/api/core#proceduredef).
