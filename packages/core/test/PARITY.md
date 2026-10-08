# @effect-trpc/core — tRPC test parity

Core-level tRPC tests (see `docs/trpc-test-inventory.txt`) and where their behaviour is covered.

| tRPC test file                                                     | local tests                                      | notes                                                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| server/src/unstable-core-do-not-import/router.test.ts              | `router.test.ts`                                 | reserved keys (`then`, `call`, `apply`), invalid keys, nested routers                     |
| server/src/unstable-core-do-not-import/router.mergeRouters.test.ts | `router.test.ts`, `inference.test-d.ts`          | `Router.merge` paths and duplicate-key errors                                             |
| tests/server/inferenceHelpers.test.ts                              | `inference.test-d.ts`                            | `inferInput/Output/Error`, `inferRouterInputs/Outputs/Errors`                             |
| server/src/unstable-core-do-not-import/clientish/inference.test.ts | `inference.test-d.ts`                            | procedure and router inference incl. subscriptions                                        |
| tests/server/regression/issue-4645-inferProcedureOutput.test.ts    | `inference.test-d.ts`                            | output inference with and without payload                                                 |
| tests/server/regression/issue-5020-inference-middleware.test.ts    | `inference.test-d.ts`                            | middleware errors flow into `inferError` and `Router.Rpcs`                                |
| tests/server/routerMeta.test.ts                                    | `router.test.ts`                                 | procedure metadata: `ProcedureKind` annotation and `router.procedures`                    |
| tests/server/transformer.test.ts                                   | `codecs.test.ts`, `e2e.test.ts`                  | Schema codecs replace transformers: class instances, `Date`s and tagged errors round-trip |
| tests/server/errors.test.ts                                        | `client-error.test.ts`, `client-error.test-d.ts` | error classification: typed `E` vs `RpcDefect` / `RpcTransportError` / `RpcInterrupted`   |
| tests/server/regression/issue-4217-throw-non-errors.test.ts        | `client-error.test.ts`                           | non-`Error` defects become `RpcDefect` with `String(defect)`                              |
