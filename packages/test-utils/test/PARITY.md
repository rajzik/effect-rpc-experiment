# tRPC parity — @effect-trpc/test-utils

tRPC has no published test-utils package; its own suites use an internal `testServerAndClient`
helper (`packages/tests/server/___testHelpers.ts`). This package is the equivalent shared harness:

| tRPC helper                        | Local equivalent                     | Tests                               |
| ---------------------------------- | ------------------------------------ | ----------------------------------- |
| `testServerAndClient(router, ...)` | `testServerAndClient(router, {...})` | `harness.test.ts`, `readme.test.ts` |
| `createCaller` in tests            | `testCaller(router, handlers)`       | `harness.test.ts`                   |
| fetch adapter tests                | `testWebHandler`, `ctx.fetch`        | `harness.test.ts`                   |
| type assertions                    | `harness.test-d.ts`                  | —                                   |
