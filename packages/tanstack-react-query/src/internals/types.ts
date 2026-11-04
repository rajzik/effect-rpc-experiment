/**
 * Shared types of the options proxy: feature flags, resolver definitions, query / mutation key
 * shapes and the `rpc` request option.
 *
 * The public ones are re-exported from the package entry. Key types describe the tRPC key layout
 * `[path, { input?, type? }]`, prefixed with `[prefix]` when the `keyPrefix` flag is on.
 *
 * @since 0.1.0
 */
import type { inferClientInput, ProcedureCallOptions } from '@effect-trpc/client';
import type { ClientError, inferError, inferOutput, ProcedureDef } from '@effect-trpc/core';
import type { InfiniteData } from '@tanstack/react-query';

/** Makes the given optional keys of `TObj` required. */
export type WithRequired<TObj, TKey extends keyof TObj> = TObj & { [P in TKey]-?: TObj[P] };

/** A value or a promise of it. */
export type MaybePromise<T> = T | Promise<T>;

/** `Omit` that distributes over unions (keeps the TanStack option overloads apart). */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Feature flags of an options proxy (tRPC's `FeatureFlags`): `keyPrefix: true` makes every query
 * and mutation key start with `[prefix]` and requires the `keyPrefix` option.
 *
 * @category models
 * @since 0.1.0
 */
export interface FeatureFlags {
  readonly keyPrefix: boolean;
}

/**
 * The default feature flags: no key prefix.
 *
 * @category models
 * @since 0.1.0
 */
export interface DefaultFeatureFlags {
  readonly keyPrefix: false;
}

/**
 * The `keyPrefix` option, required exactly when the `keyPrefix` flag is on.
 *
 * @category options
 * @since 0.1.0
 */
export type KeyPrefixOptions<TFeatureFlags extends FeatureFlags> =
  TFeatureFlags['keyPrefix'] extends true
    ? { readonly keyPrefix: string }
    : {
        /** To use a query key prefix, create the context with `{ keyPrefix: true }` feature flags. */
        readonly keyPrefix?: never;
      };

/**
 * The types the options proxy needs from one procedure (tRPC's `ResolverDef`):
 *
 * - `input`: what the client accepts (the payload's constructor input; `void` for no input)
 * - `output`: the decoded success value (the element type for subscriptions)
 * - `error`: `ClientError<E>` – the procedure's typed errors plus `RpcDefect`,
 *   `RpcTransportError` and `RpcInterrupted`
 *
 * @category type-level
 * @since 0.1.0
 */
export interface ResolverDef {
  readonly input: any;
  readonly output: any;
  readonly error: any;
  readonly featureFlags: FeatureFlags;
}

/**
 * The {@link ResolverDef} of a procedure definition.
 *
 * @category type-level
 * @since 0.1.0
 */
export interface ResolverDefOf<
  D extends ProcedureDef.Any,
  TFeatureFlags extends FeatureFlags,
> extends ResolverDef {
  readonly input: inferClientInput<D>;
  readonly output: inferOutput<D>;
  readonly error: ClientError<inferError<D>>;
  readonly featureFlags: TFeatureFlags;
}

/** `void` is accepted so procedures without input still get infinite queries (like tRPC). */
interface CursorInput {
  cursor?: any;
}
/**
 * Inputs that make a query procedure an infinite query: an object with a `cursor` key.
 *
 * @category type-level
 * @since 0.1.0
 */
export type OptionalCursorInput = CursorInput | void;

/**
 * The cursor type of an input (`unknown` when the input has no cursor).
 *
 * @category type-level
 * @since 0.1.0
 */
export type ExtractCursorType<TInput> = TInput extends CursorInput ? TInput['cursor'] : unknown;

/**
 * The page param of an infinite query over `TInput`.
 *
 * @category type-level
 * @since 0.1.0
 */
export type RpcPageParam<TInput> = NonNullable<ExtractCursorType<TInput>> | null;

/**
 * The `data` of an infinite query: TanStack's `InfiniteData` with the cursor as page param.
 *
 * @category models
 * @since 0.1.0
 */
export type RpcInfiniteData<TInput, TOutput> = InfiniteData<TOutput, RpcPageParam<TInput>>;

/**
 * Per-request options accepted by the option helpers under `rpc` (tRPC's `trpc` option).
 *
 * @category options
 * @since 0.1.0
 */
export interface RpcRequestOptions {
  /** Rpc headers for this request only, merged over the client's headers. */
  readonly headers?: ProcedureCallOptions['headers'];
}

/**
 * The `rpc` option accepted by `queryOptions`, `infiniteQueryOptions` and `mutationOptions`.
 *
 * @category options
 * @since 0.1.0
 */
export interface RpcQueryBaseOptions {
  /** effect-trpc request options (tRPC's `trpc` option). */
  readonly rpc?: RpcRequestOptions | undefined;
}

/**
 * Metadata attached to every options object (tRPC's `.trpc`).
 *
 * @category models
 * @since 0.1.0
 */
export interface RpcOptionsResult {
  readonly rpc: {
    /** The procedure path, e.g. `"post.byId"`. */
    readonly path: string;
  };
}

/**
 * `'query'` and `'infinite'` keys address one procedure; `'any'` keys address a path.
 *
 * @category models
 * @since 0.1.0
 */
export type QueryType = 'any' | 'infinite' | 'query';

/**
 * A query key without prefix: `[path, { input?, type? }]` (`[path]` for path keys).
 *
 * @category models
 * @since 0.1.0
 */
export type RpcQueryKeyWithoutPrefix = [
  path: string[],
  opts?: { input?: unknown; type?: Exclude<QueryType, 'any'> },
];

/**
 * A query key with prefix: `[[prefix], path, { input?, type? }]`.
 *
 * @category models
 * @since 0.1.0
 */
export type RpcQueryKeyWithPrefix = [prefix: string[], ...RpcQueryKeyWithoutPrefix];

/**
 * The query key type of a proxy: prefixed when the `keyPrefix` flag is on.
 *
 * @category models
 * @since 0.1.0
 */
export type RpcQueryKey<TPrefixEnabled extends boolean = false> = TPrefixEnabled extends true
  ? RpcQueryKeyWithPrefix
  : RpcQueryKeyWithoutPrefix;

/**
 * Any effect-trpc query key.
 *
 * @category models
 * @since 0.1.0
 */
export type AnyRpcQueryKey = RpcQueryKeyWithoutPrefix | RpcQueryKeyWithPrefix;

/**
 * A mutation key without prefix: `[path]`.
 *
 * @category models
 * @since 0.1.0
 */
export type RpcMutationKeyWithoutPrefix = [path: string[]];

/**
 * A mutation key with prefix: `[[prefix], path]`.
 *
 * @category models
 * @since 0.1.0
 */
export type RpcMutationKeyWithPrefix = [prefix: string[], ...RpcMutationKeyWithoutPrefix];

/**
 * The mutation key type of a proxy: prefixed when the `keyPrefix` flag is on.
 *
 * @category models
 * @since 0.1.0
 */
export type RpcMutationKey<TPrefixEnabled extends boolean = false> = TPrefixEnabled extends true
  ? RpcMutationKeyWithPrefix
  : RpcMutationKeyWithoutPrefix;

/**
 * Any effect-trpc mutation key.
 *
 * @category models
 * @since 0.1.0
 */
export type AnyRpcMutationKey = RpcMutationKeyWithoutPrefix | RpcMutationKeyWithPrefix;
