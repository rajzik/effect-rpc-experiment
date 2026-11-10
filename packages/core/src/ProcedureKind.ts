/**
 * The `ProcedureKind` annotation: which tRPC procedure kind an `effect/rpc` rpc was compiled from.
 *
 * `Router.make` annotates every compiled rpc with it, so transports, `@rpc-effect/client` and
 * the TanStack Query bridge can tell queries, mutations and subscriptions apart without the
 * original procedure definition.
 *
 * @since 0.1.0
 */
import { Context } from 'effect';

/**
 * Annotation key recording which kind of procedure an `Rpc` was compiled from.
 *
 * **When to use**
 *
 * Use when you hold a compiled rpc (from `router.group.requests`, `router.procedures` or
 * `Router.getRpc`) and need to know whether it is a query, a mutation or a subscription — e.g. to
 * choose a cache strategy or an HTTP method.
 *
 * **Details**
 *
 * - Read it with `Context.get(rpc.annotations, ProcedureKind)`.
 * - Rpcs that were not built by this package read as `"query"` (the default value).
 * - `router.procedures.get(tag)?.kind` carries the same information.
 *
 * **Example** (Reading the kind of every procedure)
 *
 * ```ts
 * import { Context, Schema } from 'effect';
 * import { mutation, ProcedureKind, query, Router } from '@rpc-effect/core';
 *
 * const appRouter = Router.make({
 *   health: query({ success: Schema.Literal('ok') }),
 *   post: { create: mutation({ payload: { title: Schema.String } }) },
 * });
 *
 * for (const [tag, rpc] of appRouter.group.requests) {
 *   const kind = Context.get(rpc.annotations, ProcedureKind); // "query" | "mutation" | ...
 *   console.log(tag, kind); // "health query", then "post.create mutation"
 * }
 * ```
 *
 * @see {@link ProcedureKind.Value}
 * @category models
 * @since 0.1.0
 */
export const ProcedureKind: Context.Reference<ProcedureKind.Value> =
  Context.Reference<ProcedureKind.Value>('@rpc-effect/core/ProcedureKind', {
    defaultValue: () => 'query',
  });

/**
 * Types of the {@link ProcedureKind} annotation.
 *
 * @category models
 * @since 0.1.0
 */
export declare namespace ProcedureKind {
  /**
   * The procedure kinds, mirroring tRPC: `"query" | "mutation" | "subscription"`.
   *
   * @since 0.1.0
   */
  export type Value = 'query' | 'mutation' | 'subscription';
}

/**
 * Alias of {@link ProcedureKind.Value}: `"query" | "mutation" | "subscription"`.
 *
 * **Example** (Typing a kind-dependent option)
 *
 * ```ts
 * import type { ProcedureKind } from '@rpc-effect/core';
 *
 * const httpMethod = (kind: ProcedureKind): 'GET' | 'POST' => (kind === 'query' ? 'GET' : 'POST');
 * ```
 *
 * @category models
 * @since 0.1.0
 */
export type ProcedureKind = ProcedureKind.Value;
