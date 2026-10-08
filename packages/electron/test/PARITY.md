# @effect-trpc/electron — tRPC test parity

tRPC has no Electron adapter or tests. The behaviours below come from tRPC tests over a persistent
duplex connection (WebSockets) and are ported to the renderer → preload bridge → main-process
`MessagePort` transport. Only the behaviours that are exercised are listed.

| tRPC test file                                          | local tests                               | notes                                                                                                                                                                                                             |
| ------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tests/server/websockets.test.ts                         | `electron.test.ts`, `messagePort.test.ts` | query, mutation, typed error, subscription and multiplexed calls over one persistent duplex connection; several clients isolated; server shutdown fails pending calls; connection closed by either side; no leaks |
| tests/server/abortQuery.test.ts                         | `electron.test.ts`                        | `AbortSignal` rejects with `RpcInterrupted` and interrupts the main-process handler (`onInterrupt`); breaking out of a subscription closes the server stream                                                      |
| tests/server/procedureErrors.client.test.ts             | `electron.test.ts`, `messagePort.test.ts` | typed `TaggedError` instances, `Schema.Class` instances (methods, `Date`), defects → `RpcDefect` with the connection still usable                                                                                 |
| tests/server/regression/issue-6461-stream-error.test.ts | `electron.test.ts`                        | a typed error emitted mid-stream is thrown by the async iterable after the preceding values                                                                                                                       |
| tests/server/headers.test.tsx                           | `electron.test.ts`, `messagePort.test.ts` | the main process adds a trusted `x-effect-trpc-sender-id` header (renderer values are replaced) that handlers read                                                                                                |
