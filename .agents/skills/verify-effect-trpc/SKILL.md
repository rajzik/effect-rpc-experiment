---
name: verify-effect-trpc
description: Use when selecting tests or verifying code, public API, toolchain, or documentation changes in this effect-trpc repository.
---

# Verify effect-trpc

Run commands from the repository root. Bootstrap with the root README's Toolchain section.
Package exports resolve through `dist/`; build the workspace before standalone checks or tests.
The verification commands below include that build.

## Select the checks

| Change                                                        | Verification                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------- |
| One package's implementation or JSDoc                         | `node scripts/verify-package.mjs <name>`                          |
| Shared contracts, transports, multiple packages, or toolchain | `pnpm ready`                                                      |
| Documentation site content                                    | `pnpm exec vp run -r build` then `pnpm docs:build`                |
| Markdown-only agent guidance or README                        | Check links and command accuracy; run `pnpm check` for formatting |

The package helper builds the workspace and checks formatting, lint with warnings denied, and
repository types, then runs the selected package's runtime tests, type tests, and JSDoc examples.
It does not run downstream packages' tests. Use `pnpm ready` for changes to shared behavior.
`node scripts/verify-toolchain.mjs` delegates to that full sequence.

For framework example behavior, also run the affected app's `example:test` script. Read
`.github/workflows/examples.yml` for browser or Electron prerequisites and commands scoped to
that app. `pnpm ready` does not run those Playwright suites or build the documentation site.

## Prove the behavior

Read the changed package's README and nearby public API tests before adding coverage.
For RPC tests, use `@effect-trpc/test-utils` and its documented harness:

- Serialization or typed errors crossing the wire: `testServerAndClient` or `testWebHandler`.
  `testCaller` bypasses transport and codecs.
- In-process handler behavior: `testCaller`.
- Dispose harnesses with `await using` or the documented scoped helper.

Pair every typed-error claim with a `.test-d.ts` check. Update the package's `test/PARITY.md`
when porting or changing tRPC coverage. API changes also update JSDoc and the package README's
`For AI agents` section; the JSDoc verifier type-checks examples against built packages.

Report the commands run and their results, including failures and checks not run.
