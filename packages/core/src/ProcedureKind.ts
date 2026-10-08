import { Context } from 'effect';

/**
 * Annotation key recording which kind of procedure an `Rpc` was compiled from.
 *
 * Every rpc produced by `Router.make` is annotated with it, so transports and
 * client bridges can tell queries, mutations and subscriptions apart:
 *
 * ```ts
 * Context.get(rpc.annotations, ProcedureKind) // "query" | "mutation" | "subscription"
 * ```
 *
 * Rpcs that were not built by this package read as `"query"` (the default).
 */
export const ProcedureKind: Context.Reference<ProcedureKind.Value> =
  Context.Reference<ProcedureKind.Value>('@effect-trpc/core/ProcedureKind', {
    defaultValue: () => 'query',
  });

export declare namespace ProcedureKind {
  /** The procedure kinds, mirroring tRPC. */
  export type Value = 'query' | 'mutation' | 'subscription';
}

/** Alias of {@link ProcedureKind.Value}. */
export type ProcedureKind = ProcedureKind.Value;
