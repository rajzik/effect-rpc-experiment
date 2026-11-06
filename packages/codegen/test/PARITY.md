# tRPC parity — @effect-trpc/codegen

tRPC has no schema generator: its procedures infer output types without runtime schemas and rely
on a transformer (e.g. superjson) for non-JSON values. This package has no ported tRPC tests.

| Concern                              | Local tests                                            |
| ------------------------------------ | ------------------------------------------------------ |
| inferred output / error schemas      | `generate.test.ts` (reports, runtime round trip)       |
| client contract (no handlers, types) | `generate.test.ts`, `clientTypes.test-d.ts`            |
| drift detection                      | `generate.test.ts` (contract check, committed fixture) |
| unmappable types                     | `generate.test.ts` (`fixtures/bad`)                    |
| schemas from other packages          | `monorepo.test.ts` (`fixtures/mono`)                   |
| CLI, watch mode, Vite plugin         | `tooling.test.ts`                                      |
