# Effect client

`client.$effect` mirrors the router with Effect-returning functions. Use it from Effect programs:
the calls compose with `pipe`, retries, timeouts, `Effect.all` and structured concurrency like any
other Effect.

<<< @/snippets/client/effect-client.ts#basics

|                  | Promise client                | Effect client                                 |
| ---------------- | ----------------------------- | --------------------------------------------- |
| query / mutation | `Promise<A>`                  | `Effect<A, E \| RpcTransportError>`           |
| subscription     | `AsyncIterable<A>`            | `Stream<A, E \| RpcTransportError>`           |
| requirements     | —                             | none (`R = never`)                            |
| defect           | rejects with `RpcDefect`      | a defect: `Effect.catchDefect`                |
| cancellation     | rejects with `RpcInterrupted` | interruption                                  |
| per-call options | `{ signal, headers }`         | `{ headers }` (interrupt the fiber to cancel) |

## As a service

Programs that depend on the API, not on a URL, test easily: provide a `localLink` client in tests.

<<< @/snippets/client/effect-client.ts#service

`Client.Effect<R>` is the type of `client.$effect`.

::: warning Gotchas

- The connection belongs to the client, not to the Effect. Dispose the client (or tie it to a scope
  as above) when you are done.
- `Effect.timeout` interrupts the call, which cancels the server handler too.
- Only `RpcTransportError` is worth retrying. Your errors and defects come back the same on retry.

:::

See also: [`EffectClient`](/api/client#effectclient), [`Client`](/api/client#client).
