# Testing with the caller

For handler logic, skip HTTP: the in-process caller runs the handlers and middleware with no
serialization, and its Effect API has an exact error channel. Pair it with `@effect/vitest`'s
`it.effect` (re-exported as `effectIt`).

## Handlers

<<< @/snippets/testing/caller.test.ts#caller

`testCaller(router, handlers)` is `createCaller(router, { handlers })`, disposable with
`await using`. `Effect.flip` turns the expected failure into the success value, so you can assert on
it.

## Middleware and headers

<<< @/snippets/testing/caller.test.ts#headers

Per-call `headers` reach middleware exactly as HTTP headers do, so auth paths are testable without a
server.

## Client code against fake handlers

<<< @/snippets/testing/caller.test.ts#fake

Code that takes a client (a component, a service, a store) gets a real client over `localLink` with
fake handlers. The fake must still implement every procedure, which keeps fakes honest when the
router changes.

::: tip What to use when

| You are testing                      | Use                                       |
| ------------------------------------ | ----------------------------------------- |
| one handler's logic                  | `testCaller` + `effectIt.effect`          |
| client code (components, services)   | `createClient` with `localLink` and fakes |
| serialization, HTTP status, adapters | `testWebHandler` or `testServerAndClient` |
| the whole stack                      | `testServerAndClient`                     |

:::

See also: [`testCaller`](/api/test-utils#testcaller), [the caller](../server/caller).
