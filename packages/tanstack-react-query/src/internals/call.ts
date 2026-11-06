/**
 * Internal: the procedure-calling contract shared by the option builders.
 *
 * `createRpcOptionsProxy` implements {@link ProcedureCaller} on top of the Promise client; the
 * builders only pass the path, input and per-call options (signal, headers).
 *
 * @since 0.1.0
 */
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
