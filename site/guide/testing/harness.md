# Test harness

`@rpc-effect/test-utils` starts a real server for a router and gives you every way to call it, so a
test covers routing, serialization, middleware and errors as production does.

```sh
pnpm add -D @rpc-effect/test-utils @effect/vitest vitest
```

## A server and clients, per test

<<< @/snippets/testing/harness.test.ts#harness

`testServerAndClient(router, options)` returns:

| Field          | What                                                              |
| -------------- | ----------------------------------------------------------------- |
| `client`       | Promise client over `httpLink` to the server                      |
| `effectClient` | the same client's `$effect` API                                   |
| `caller`       | an in-process caller over the same handlers                       |
| `url`          | the absolute endpoint URL (a free port)                           |
| `fetch`        | `fetch` against the server; relative URLs resolve against `url`   |
| `dispose()`    | closes the client, the caller and the server (also `await using`) |

Options: `handlers` (required), `serialization` (`'ndjson'` default, used by both sides), `path`
(`'/rpc'`), `headers` (sent with every call) and `middleware` (client halves of
`requiredForClient` middleware).

## Scoped to a callback

<<< @/snippets/testing/harness.test.ts#with

`withTestServer` runs the callback against a fresh harness and always disposes it, even when the
callback throws.

## No port: the fetch handler

<<< @/snippets/testing/web-handler.test.ts

`testWebHandler` runs the full HTTP wire format through `toWebHandler`, without opening a port.
This is how the Next.js and TanStack Start adapters are tested.

## Assertions

`assertInstance(value, Class)` asserts `value instanceof Class` and narrows its type, with a
readable failure message. Use it for `Schema.Class` and `Schema.TaggedError` values that crossed the
wire. Inside `Effect.gen`, a failed assertion is a defect that fails the test.

::: warning Gotchas

- The server, the web handler and the caller each build the handler layer separately. State created
  inside the layer is not shared between them. State captured outside the layer (a module-level
  array, as in the demo server) is.
- `dispose()` runs every finalizer and rethrows the first failure: a failing finalizer fails the
  test.
- Tests share nothing else: each call to `testServerAndClient` picks a new port.

:::

See also: [`testServerAndClient`](/api/test-utils#testserverandclient),
[`withTestServer`](/api/test-utils#withtestserver), [`testWebHandler`](/api/test-utils#testwebhandler).
