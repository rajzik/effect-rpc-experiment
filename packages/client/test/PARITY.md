# @effect-trpc/client — tRPC test parity

Client-level tRPC tests (see `docs/trpc-test-inventory.txt`) and where their behaviour is covered.
Only behaviours that are actually exercised are listed; the notes name the subset that was ported.

| tRPC test file                                                | local tests         | notes                                                                                                                                    |
| ------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| tests/server/abortQuery.test.ts                               | `abort.test.ts`     | `AbortSignal` rejects with `RpcInterrupted` and interrupts the server handler over local, HTTP and WebSocket links; pre-aborted signal   |
| tests/server/headers.test.tsx                                 | `localLink.test.ts` | client-level, `withHeaders` and per-call headers reach middleware (later wins); HTTP/WS variants in `httpLink.test.ts`, `wsLink.test.ts` |
| tests/server/regression/issue-2506-headers-throwing.test.ts   | `localLink.test.ts` | a throwing `headers()` function fails the call with `RpcTransportError` instead of crashing                                              |
| tests/server/createClient.test.ts                             | `localLink.test.ts` | `createClient` over a link: nested calls, lazy single link build, `dispose`, calls after dispose                                         |
| server/src/unstable-core-do-not-import/createProxy.test.ts    | `localLink.test.ts` | proxy: unknown path / namespace call errors, not thenable, stable references, reserved keys                                              |
| client/src/links/localLink.test.ts                            | `localLink.test.ts` | in-process link: queries, mutations, subscriptions, instances preserved                                                                  |
| client/src/links/localLink.procedureErrors.test.ts            | `localLink.test.ts` | typed `TaggedError` instances, defects → `RpcDefect` and later calls still work                                                          |
| client/src/safe.test.ts                                       | `localLink.test.ts` | the Effect client (`$effect`) returns typed failures instead of throwing; `catchTag` narrows                                             |
| tests/server/regression/issue-2540-undefined-mutation.test.ts | `localLink.test.ts` | mutation without input callable with no argument and with `undefined`                                                                    |
| tests/server/procedureErrors.client.test.ts                   | `httpLink.test.ts`  | typed errors, defects and class instances over a real HTTP server (NDJSON and JSON)                                                      |
| tests/server/httpSubscriptionLink.test.ts                     | `httpLink.test.ts`  | subscriptions over HTTP streaming: in-order chunks, typed mid-stream error thrown from the async iterable                                |
| tests/server/links.test.ts                                    | `httpLink.test.ts`  | `httpLink` options: custom `fetch`, static and per-request headers, absolute URL validation, non-2xx/network → `RpcTransportError`       |
| tests/server/websockets.test.ts                               | `wsLink.test.ts`    | query, mutation, typed error, subscription and concurrent multiplexed calls over a real WebSocket server; abort in `abort.test.ts`       |
| tests/server/inferenceHelpers.test.ts                         | `client.test-d.ts`  | client-side inference: `Promise<Output>`, `ClientError<E>` rejection type, exact Effect error channel, input checking                    |
