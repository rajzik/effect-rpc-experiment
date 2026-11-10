# Promise client

`createClient(router, { link })` returns a client that mirrors the router. Each procedure is a
function that returns a `Promise` (a query or mutation) or an `AsyncIterable` (a subscription).
Results are decoded with the procedure's schemas, so classes arrive as instances.

## Create

<<< @/snippets/client/create-client.ts#create

| Option       | What                                                                                |
| ------------ | ----------------------------------------------------------------------------------- |
| `link`       | the transport: `httpLink`, `wsLink`, `localLink`, or your own ([links](./links))    |
| `headers`    | headers for every call: a value or a (possibly async) function evaluated per call   |
| `middleware` | client halves of `requiredForClient` middleware ([client middleware](./middleware)) |

## Call

<<< @/snippets/client/create-client.ts#calls

Every call takes an optional second argument: `{ signal, headers }`. See
[headers, cancellation and options](./call-options).

## Errors

A call rejects with `ClientError<E>`: the procedure's errors, or `RpcDefect`, `RpcTransportError`,
`RpcInterrupted`. Narrow on `_tag`. The full model is in [the error model](../concepts/errors).

```ts
import type { Client } from '@rpc-effect/client';

type ByIdError = Client.Error<typeof appRouter.record.post.byId>; // ClientError<PostNotFound>
```

## Lifecycle

<<< @/snippets/client/create-client.ts#lifecycle

## The client object

| Member                  | What                                                    |
| ----------------------- | ------------------------------------------------------- |
| `client.<path>(...)`    | Promise / AsyncIterable calls                           |
| `client.$effect`        | the [Effect client](./effect-client)                    |
| `client.$router`        | the router                                              |
| `client.withHeaders(h)` | a client on the same connection with extra headers      |
| `client.dispose()`      | closes the link's resources; also `Symbol.asyncDispose` |

::: warning Gotchas

- The URL must be absolute. In a browser use `new URL('/rpc', location.origin)`; during SSR use the
  server's own origin (the framework adapters have a `getBaseUrl`).
- `$effect`, `$router`, `withHeaders` and `dispose` are reserved top-level router keys:
  `createClient` throws if the router uses one.
- Calling a path that is not a procedure throws an `Error` right away.
- In React, create the client once (`useState(() => createClient(...))`), not on every render.

:::

See also: [`createClient`](/api/client#createclient), [`Client`](/api/client#client).
