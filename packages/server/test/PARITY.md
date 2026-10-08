# @effect-trpc/server — tRPC test parity

Server-level tRPC tests (paths as listed in `docs/trpc-test-inventory.txt`) and the local test
file that ports their behaviour. One row per (tRPC file, local file) pair.

| tRPC test                                                                | local test               | notes                                                                                                       |
| ------------------------------------------------------------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| packages/tests/server/middlewares.test.ts                                | middlewares.test.ts      | router-level + procedure middleware, execution order, provided context (`yield* Session`), typed mw errors  |
| packages/tests/server/middlewares.test.ts                                | handlers.test.ts         | middleware-provided `CurrentUser` reaches handlers through `RpcTest.makeClient`; short-circuit on failure   |
| packages/tests/server/procedureErrors.test.ts                            | procedure-errors.test.ts | declared errors arrive as instances; thrown exceptions / non-Error throws become `RpcDefect` (Die on wire)  |
| packages/tests/server/input.test.ts                                      | validation.test.ts       | invalid / missing payload → decode failure answered as `Die`, server keeps serving; caller → `RpcDefect`    |
| packages/tests/server/outputParser.test.ts                               | validation.test.ts       | result violating the success schema → encode failure as `Die` / `RpcDefect`; next call fine                 |
| packages/tests/server/abortQuery.test.ts                                 | caller.test.ts           | `AbortSignal` → `RpcInterrupted`, handler `onInterrupt` observed; pre-aborted signal rejects immediately    |
| packages/tests/server/abortQuery.test.ts                                 | node.test.ts             | client fiber interruption over real HTTP interrupts the server handler                                      |
| packages/tests/server/streaming.test.ts                                  | streaming.test.ts        | stream of instances over HTTP and in-process, empty stream, `take` cancels the producer (finalizer runs)    |
| packages/tests/server/headers.test.tsx                                   | web-handler.test.ts      | HTTP request headers reach middleware and handler `ctx.headers`                                             |
| packages/tests/server/headers.test.tsx                                   | caller.test.ts           | per-call `headers` option reaches middleware (`x-user` → `CurrentUser`) and handlers                        |
| packages/tests/server/caller.test.ts                                     | caller.test.ts           | `createCaller`: Effect + Promise APIs, typed errors, defects, unknown path throws, dispose                  |
| packages/tests/server/createCaller.test.ts                               | caller.test.ts           | caller over merged routers and deep paths, layer build failure surfaces as `RpcDefect`                      |
| packages/tests/server/callRouter.test.ts                                 | caller.test.ts           | calling procedures by nested path through the proxy                                                         |
| packages/tests/server/smoke.test.ts                                      | smoke.test.ts            | query / mutation / subscription round trip over HTTP and in-process                                         |
| packages/tests/server/adapters/fetch.test.ts                             | web-handler.test.ts      | `toWebHandler`: success, typed failure, defect then next request, NDJSON chunks, unknown tag, dispose, json |
| packages/tests/server/adapters/standalone.test.ts                        | node.test.ts             | `runServer` on port 0, `RpcClient` over HTTP gets instances / errors / defects / streams; closes on dispose |
| packages/tests/server/regression/issue-2540-undefined-mutation.test.ts   | smoke.test.ts            | mutation without input over HTTP, in-process and with a `null` wire payload                                 |
| packages/tests/server/regression/issue-5945-stream-null.test.ts          | streaming.test.ts        | `null` stream elements survive HTTP and the async iterable                                                  |
| packages/tests/server/regression/issue-6461-stream-error.test.ts         | streaming.test.ts        | typed error after elements reaches the client as an instance (HTTP, async iterable, Effect stream)          |
| packages/tests/server/regression/issue-4217-throw-non-errors.test.ts     | procedure-errors.test.ts | a thrown string becomes `RpcDefect` with that message                                                       |
| packages/tests/server/errors.test.ts                                     | procedure-errors.test.ts | typed errors vs defects, both in-process and on the wire                                                    |
| packages/tests/server/inferenceHelpers.test.ts                           | caller.test-d.ts         | caller input / output / error types (incl. middleware errors) per procedure                                 |
| packages/tests/server/regression/issue-5020-inference-middleware.test.ts | caller.test-d.ts         | middleware errors appear in the caller's error type                                                         |
| packages/server/src/unstable-core-do-not-import/procedureBuilder.test.ts | handlers.test-d.ts       | handler implementations are checked against the procedure: missing handler / wrong output / wrong error     |
