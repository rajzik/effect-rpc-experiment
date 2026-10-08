import type { ProcedureCallOptions } from '@effect-trpc/client';

/**
 * Calls the procedure at `path` with the Promise client: queries and mutations return a
 * `Promise`, subscriptions an `AsyncIterable`.
 */
export type ProcedureCaller = (
  path: ReadonlyArray<string>,
  input: unknown,
  options: ProcedureCallOptions,
) => unknown;

/** Builds the per-call options from an AbortSignal and the `rpc` request options. */
export const callOptions = (
  signal: AbortSignal | undefined,
  rpc: { readonly headers?: ProcedureCallOptions['headers'] } | undefined,
): ProcedureCallOptions => ({
  ...(signal !== undefined && { signal }),
  ...(rpc?.headers !== undefined && { headers: rpc.headers }),
});
