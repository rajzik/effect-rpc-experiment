/**
 * Schema-aware SSR hydration: TanStack's `dehydrate` / `hydrate` / `HydrationBoundary` for a
 * router.
 *
 * TanStack's own `dehydrate` puts `Schema.Class` instances, `Date`s and `Schema.TaggedError`s into
 * the payload as-is, so they do not survive JSON. These helpers encode the router's queries with
 * the procedures' schemas (`Codecs.success` from `@effect-trpc/core`, per page for infinite
 * queries; errors as an `Exit`) and decode them back to instances on the client. Queries with
 * other keys pass through unchanged. `@effect-trpc/next` and `@effect-trpc/start` build on them.
 *
 * @since 0.1.0
 */
import {
  Codecs,
  isClientInfrastructureError,
  RpcDefect,
  RpcInterrupted,
  RpcTransportError,
  causeToClientError,
} from '@effect-trpc/core';
import type { ProcedureInfo, Router } from '@effect-trpc/core';
import {
  dehydrate as tanstackDehydrate,
  defaultShouldDehydrateQuery,
  hydrate as tanstackHydrate,
  HydrationBoundary as TanstackHydrationBoundary,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  DehydratedState,
  DehydrateOptions,
  HydrateOptions,
  HydrationBoundaryProps,
  Query,
  QueryClient,
} from '@tanstack/react-query';
import { Exit, Schema } from 'effect';
import * as React from 'react';
import { parseQueryKey } from './internals/keys.js';

/**
 * Options of `dehydrate`: TanStack's `DehydrateOptions` plus `dehydrateErrors`.
 *
 * **Details**
 *
 * - `shouldDehydrateQuery`, `serializeData` and `shouldRedactErrors` fall back to the
 *   `QueryClient`'s `defaultOptions.dehydrate`, like TanStack.
 * - `serializeData` runs after the schema encoding (on JSON-safe values).
 * - The default `shouldRedactErrors` (for queries dehydrated while pending) keeps procedure
 *   `TaggedError`s and redacts everything else.
 *
 * @see {@link dehydrate}
 * @category hydration
 * @since 0.1.0
 */
export interface RpcDehydrateOptions extends DehydrateOptions {
  /**
   * Also dehydrate failed queries of the router, encoding their `ClientError` (typed errors and
   * `RpcDefect` / `RpcTransportError` / `RpcInterrupted`) so that `hydrate` restores the class
   * instance. Default `true`.
   */
  readonly dehydrateErrors?: boolean | undefined;
  /**
   * The `keyPrefix` of the options proxy whose queries are dehydrated (default: none). Only
   * queries with this prefix are encoded; queries of another prefix (another router sharing the
   * `QueryClient`) are left out for that router's own `dehydrate`.
   */
  readonly keyPrefix?: string | undefined;
}

/**
 * Options of {@link hydrate}: TanStack's `HydrateOptions` plus the `keyPrefix` whose queries are
 * decoded.
 *
 * **Gotchas**
 *
 * - `keyPrefix` must equal the one given to {@link dehydrate}; queries of another prefix are not
 *   hydrated (another router's helpers own them).
 *
 * @see {@link hydrate}
 * @category hydration
 * @since 0.1.0
 */
export interface RpcHydrateOptions extends HydrateOptions {
  /** The `keyPrefix` of the options proxy whose queries are hydrated (default: none). */
  readonly keyPrefix?: string | undefined;
}

/**
 * Options of {@link createHydrationHelpers}.
 *
 * @see {@link createHydrationHelpers}
 * @category hydration
 * @since 0.1.0
 */
export interface HydrationHelpersOptions {
  /**
   * The `keyPrefix` of the options proxy (`createRpcOptionsProxy` / `RpcProvider`) the helpers
   * serve. Required when several routers share one `QueryClient`, so that each one only encodes
   * and decodes its own queries. Default: no prefix.
   */
  readonly keyPrefix?: string | undefined;
}

/**
 * Props of the effect-trpc `HydrationBoundary`: the same as TanStack's (`state`, `options`,
 * `queryClient`, `children`).
 *
 * @see {@link createHydrationHelpers}
 * @category hydration
 * @since 0.1.0
 */
export type RpcHydrationBoundaryProps = HydrationBoundaryProps;

/**
 * Dehydration helpers bound to a router, returned by {@link createHydrationHelpers}.
 *
 * @see {@link createHydrationHelpers}
 * @category hydration
 * @since 0.1.0
 */
export interface HydrationHelpers {
  /**
   * TanStack's `dehydrate`, with the data and errors of the router's queries encoded to JSON-safe
   * values with the procedures' schemas (`Schema.Class` instances, `Date`s, `TaggedError`s, ...).
   */
  readonly dehydrate: (queryClient: QueryClient, options?: RpcDehydrateOptions) => DehydratedState;
  /** TanStack's `hydrate`, decoding what `dehydrate` encoded back to real instances. */
  readonly hydrate: (
    queryClient: QueryClient,
    state: DehydratedState | null | undefined,
    options?: RpcHydrateOptions,
  ) => void;
  /** TanStack's `HydrationBoundary`, decoding what `dehydrate` encoded back to real instances. */
  readonly HydrationBoundary: React.FC<RpcHydrationBoundaryProps>;
}

/** Recorded on each dehydrated query whose data / error was encoded. */
interface EncodedMarker {
  /** `infinite`: `state.data` is `InfiniteData` whose pages are encoded. */
  readonly type: 'query' | 'infinite';
  /** How `state.error` was encoded. */
  readonly error?: 'exit' | 'infrastructure';
}

const markerKey = 'effectTrpc';

type MarkedQuery = DehydratedState['queries'][number] & {
  readonly [markerKey]?: EncodedMarker;
};

const infrastructureCodec = Schema.toCodecJson(
  Schema.Union([RpcDefect, RpcTransportError, RpcInterrupted]),
);
const encodeInfrastructure = Schema.encodeSync(infrastructureCodec);
const decodeInfrastructure = Schema.decodeUnknownSync(infrastructureCodec);

interface InfiniteDataLike {
  readonly pages: ReadonlyArray<unknown>;
  readonly pageParams: ReadonlyArray<unknown>;
}

const isInfiniteData = (value: unknown): value is InfiniteDataLike =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as InfiniteDataLike).pages) &&
  Array.isArray((value as InfiniteDataLike).pageParams);

const mapData = (
  type: EncodedMarker['type'],
  data: unknown,
  f: (value: unknown) => unknown,
): unknown => {
  if (type === 'query') return f(data);
  if (!isInfiniteData(data)) throw new Error('expected infinite query data');
  return { ...data, pages: data.pages.map(f) };
};

const encodeError = (
  rpc: ProcedureInfo['rpc'],
  error: unknown,
): { readonly error: unknown; readonly kind: 'exit' | 'infrastructure' } => {
  if (isClientInfrastructureError(error)) {
    // The `cause` of a defect / transport error is server-side detail (stack traces): drop it.
    const safe =
      error._tag === '@effect-trpc/RpcDefect'
        ? new RpcDefect({ message: error.message, cause: undefined })
        : error._tag === '@effect-trpc/RpcTransportError'
          ? new RpcTransportError({ message: error.message, cause: undefined })
          : error;
    return { error: encodeInfrastructure(safe), kind: 'infrastructure' };
  }
  try {
    return { error: Codecs.encodeExitSync(rpc, Exit.fail(error)), kind: 'exit' };
  } catch {
    // Not one of the procedure's errors: keep it as a defect.
    return { error: Codecs.encodeExitSync(rpc, Exit.die(error)), kind: 'exit' };
  }
};

const decodeError = (
  rpc: ProcedureInfo['rpc'],
  error: unknown,
  kind: 'exit' | 'infrastructure',
): unknown => {
  if (kind === 'infrastructure') return decodeInfrastructure(error);
  const exit = Codecs.decodeExitSync(rpc, error);
  return Exit.isFailure(exit) ? causeToClientError(exit.cause) : undefined;
};

/** Maps a dehydrated promise; the mapped promise never causes an unhandled rejection. */
const mapPromise = (promise: PromiseLike<unknown>, f: (value: unknown) => unknown) => {
  const mapped = Promise.resolve(promise).then(f);
  mapped.catch(() => {});
  return mapped;
};

const identity = <A,>(a: A): A => a;

/**
 * Default `shouldRedactErrors` (applies to queries dehydrated while pending): keep the typed
 * errors of procedures (`TaggedError`s), redact everything else like TanStack does.
 */
const redactUnlessTypedError = (error: unknown): boolean =>
  !(
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { readonly _tag?: unknown })._tag === 'string' &&
    !isClientInfrastructureError(error)
  );

/** The router and key prefix whose queries a `dehydrate` / `hydrate` call owns. */
interface Owner {
  readonly router: Router.Any;
  /** `undefined` for unprefixed keys (`""` is no prefix, as in the options proxy). */
  readonly prefix: string | undefined;
}

const ownerOf = (router: Router.Any, keyPrefix: string | undefined): Owner => ({
  router,
  prefix: keyPrefix === '' ? undefined : keyPrefix,
});

/**
 * - `owned`: a query of the owner's router and prefix, encoded with its procedure's schemas.
 * - `foreign`: an effect-trpc query key of another prefix: another router's helpers own it.
 * - `other`: any other query (not an effect-trpc key, or not a query procedure of the router).
 */
type Ownership =
  | { readonly _tag: 'owned'; readonly info: ProcedureInfo; readonly type: EncodedMarker['type'] }
  | { readonly _tag: 'foreign' }
  | { readonly _tag: 'other' };

const ownership = (owner: Owner, queryKey: ReadonlyArray<unknown>): Ownership => {
  const parsed = parseQueryKey(queryKey);
  if (parsed === undefined) return { _tag: 'other' };
  if (parsed.prefix !== owner.prefix) return { _tag: 'foreign' };
  const info = owner.router.procedures.get(parsed.path.join('.'));
  if (info === undefined || info.kind !== 'query') return { _tag: 'other' };
  return { _tag: 'owned', info, type: parsed.type };
};

/**
 * TanStack's `dehydrate` for a router: returns a JSON-safe `DehydratedState` in which the router's
 * queries are encoded with their procedures' schemas.
 *
 * **When to use**
 *
 * Use on the server after prefetching, when the state is sent to the browser as JSON. Prefer the
 * `dehydrate` of {@link createHydrationHelpers}, which binds the router once.
 *
 * **Details**
 *
 * - Data of every query of the router is encoded with `Codecs.success(rpc)` (each page for
 *   infinite queries). Queries with other keys are dehydrated unchanged.
 * - Only queries with `options.keyPrefix` (default: none) belong to the router; effect-trpc
 *   queries of another prefix are left out (that router's own `dehydrate` encodes them).
 * - Unless `dehydrateErrors: false`, failed queries of the router are included: typed errors are
 *   encoded as an `Exit`, `RpcDefect` / `RpcTransportError` / `RpcInterrupted` with their own
 *   schemas. The `cause` of a defect / transport error is dropped (it may hold server details).
 * - Pending queries (streaming SSR) are supported: their promise resolves to the encoded data.
 * - A query whose value cannot be encoded is left out; the client fetches it.
 *
 * **Gotchas**
 *
 * - Do not use `dehydrate` from `@tanstack/react-query` for these queries: `Schema.Class`
 *   instances and `Date`s turn into plain JSON objects and strings. Pair this function with
 *   {@link hydrate} or the `HydrationBoundary` of {@link createHydrationHelpers}; TanStack's
 *   `HydrationBoundary` would leave the encoded values encoded.
 *
 * **Example** (Dehydrating a prefetched query on the server)
 *
 * ```ts
 * import type { Client } from '@effect-trpc/client';
 * import { query, Router } from '@effect-trpc/core';
 * import { Schema } from 'effect';
 *
 * class Post extends Schema.Class<Post>('Post')({
 *   id: Schema.Number,
 *   title: Schema.String,
 *   createdAt: Schema.Date,
 * }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * import { createRpcOptionsProxy, dehydrate } from '@effect-trpc/tanstack-react-query';
 * import { QueryClient } from '@tanstack/react-query';
 *
 * declare const client: Client<typeof appRouter>;
 *
 * export async function renderState(id: number): Promise<string> {
 *   const queryClient = new QueryClient();
 *   const rpc = createRpcOptionsProxy({ client, queryClient });
 *   await queryClient.prefetchQuery(rpc.post.byId.queryOptions({ id }));
 *   // A PostNotFound failure is included too (dehydrateErrors defaults to true).
 *   return JSON.stringify(dehydrate(appRouter, queryClient));
 * }
 * ```
 *
 * @see {@link hydrate}
 * @see {@link createHydrationHelpers}
 * @category hydration
 * @since 0.1.0
 */
export const dehydrate = (
  router: Router.Any,
  queryClient: QueryClient,
  options: RpcDehydrateOptions = {},
): DehydratedState => {
  const { dehydrateErrors = true, keyPrefix, ...rest } = options;
  const owner = ownerOf(router, keyPrefix);
  const defaults = queryClient.getDefaultOptions().dehydrate;
  const shouldDehydrate =
    rest.shouldDehydrateQuery ?? defaults?.shouldDehydrateQuery ?? defaultShouldDehydrateQuery;
  const serializeData = rest.serializeData ?? defaults?.serializeData ?? identity;
  const state = tanstackDehydrate(queryClient, {
    ...rest,
    serializeData: identity,
    shouldDehydrateQuery: (query: Query) =>
      shouldDehydrate(query) ||
      (dehydrateErrors &&
        query.state.status === 'error' &&
        ownership(owner, query.queryKey)._tag === 'owned'),
    shouldRedactErrors:
      rest.shouldRedactErrors ?? defaults?.shouldRedactErrors ?? redactUnlessTypedError,
  });
  const queries = state.queries.flatMap((query): Array<MarkedQuery> => {
    const found = ownership(owner, query.queryKey);
    if (found._tag === 'foreign') return [];
    if (found._tag === 'other') {
      if (serializeData === identity) return [query];
      return [
        {
          ...query,
          state: {
            ...query.state,
            ...(query.state.data !== undefined && { data: serializeData(query.state.data) }),
          },
          ...(query.promise !== undefined && {
            promise: mapPromise(query.promise, serializeData),
          }),
        },
      ];
    }
    const { info, type } = found;
    const encode = (data: unknown): unknown =>
      serializeData(mapData(type, data, (value) => Codecs.encodeSuccessSync(info.rpc, value)));
    const { data, error } = query.state;
    // Included by a custom `shouldDehydrateQuery` although errors are not to be dehydrated.
    if (error !== null && !dehydrateErrors) return [];
    try {
      const encodedError = error === null ? undefined : encodeError(info.rpc, error);
      const marker: EncodedMarker = {
        type,
        ...(encodedError !== undefined && { error: encodedError.kind }),
      };
      return [
        {
          ...query,
          state: {
            ...query.state,
            ...(data !== undefined && { data: encode(data) }),
            ...(encodedError !== undefined && { error: encodedError.error as Error }),
            // The same raw error instance: restored from `error` by `hydrate`.
            fetchFailureReason: null,
          },
          ...(query.promise !== undefined && { promise: mapPromise(query.promise, encode) }),
          [markerKey]: marker,
        },
      ];
    } catch {
      return [];
    }
  });
  return { ...state, queries };
};

/**
 * Decodes a dehydrated state produced by {@link dehydrate} (applying `deserializeData` to every
 * query). Queries that fail to decode are dropped, so the client fetches them again.
 */
const decodeState = (
  owner: Owner,
  state: DehydratedState,
  deserializeData: (data: any) => any,
): DehydratedState => {
  const queries = state.queries.flatMap((query) => {
    const { [markerKey]: marker, ...plain } = query as MarkedQuery;
    if (marker === undefined) {
      if (deserializeData === identity) return [plain];
      return [
        {
          ...plain,
          state: {
            ...plain.state,
            ...(plain.state.data !== undefined && { data: deserializeData(plain.state.data) }),
          },
          ...(plain.promise !== undefined && {
            promise: mapPromise(plain.promise, deserializeData),
          }),
        },
      ];
    }
    const found = ownership(owner, query.queryKey);
    // Encoded by another router (or prefix): hydrated by that router's helpers, or fetched.
    if (found._tag !== 'owned') return [];
    const { info } = found;
    const decode = (data: unknown): unknown =>
      mapData(marker.type, deserializeData(data), (value) =>
        Codecs.decodeSuccessSync(info.rpc, value),
      );
    try {
      const { data, error } = plain.state;
      const decodedError =
        marker.error !== undefined && error !== null
          ? (decodeError(info.rpc, error, marker.error) as Error)
          : undefined;
      return [
        {
          ...plain,
          state: {
            ...plain.state,
            ...(data !== undefined && { data: decode(data) }),
            ...(decodedError !== undefined && {
              error: decodedError,
              fetchFailureReason: decodedError,
            }),
          },
          ...(plain.promise !== undefined && { promise: mapPromise(plain.promise, decode) }),
        },
      ];
    } catch {
      return [];
    }
  });
  return { ...state, queries };
};

const deserializerOf = (
  queryClient: QueryClient,
  options: HydrateOptions | undefined,
): ((data: any) => any) =>
  options?.defaultOptions?.deserializeData ??
  queryClient.getDefaultOptions().hydrate?.deserializeData ??
  identity;

const withIdentityDeserializer = <O extends { defaultOptions?: object | undefined }>(
  options: O | undefined,
): O =>
  ({
    ...options,
    defaultOptions: { ...options?.defaultOptions, deserializeData: identity },
  }) as O;

/**
 * TanStack's `hydrate` for a router: decodes what {@link dehydrate} encoded (data with
 * `Codecs.success`, errors as an `Exit` or infrastructure error) back to class instances, then
 * hydrates the `QueryClient`.
 *
 * **When to use**
 *
 * Use to hydrate imperatively (e.g. when creating the browser `QueryClient` from an inline
 * payload). In React trees prefer the `HydrationBoundary` of {@link createHydrationHelpers}.
 *
 * **Details**
 *
 * - `null` / `undefined` states are ignored.
 * - Only queries with `options.keyPrefix` (default: none) are decoded; encoded queries of another
 *   prefix are left for that router's helpers.
 * - `deserializeData` (from `options` or the client's defaults) runs before the schema decoding.
 * - Queries that fail to decode are dropped, so the client fetches them again.
 *
 * **Example** (Hydrating the browser QueryClient)
 *
 * ```ts
 * import { query, Router } from '@effect-trpc/core';
 * import { Schema } from 'effect';
 *
 * class Post extends Schema.Class<Post>('Post')({
 *   id: Schema.Number,
 *   title: Schema.String,
 *   createdAt: Schema.Date,
 * }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * import { hydrate } from '@effect-trpc/tanstack-react-query';
 * import { QueryClient, type DehydratedState } from '@tanstack/react-query';
 *
 * declare const payload: string; // JSON.stringify(dehydrate(appRouter, serverQueryClient))
 *
 * const queryClient = new QueryClient();
 * hydrate(appRouter, queryClient, JSON.parse(payload) as DehydratedState);
 * ```
 *
 * @see {@link dehydrate}
 * @category hydration
 * @since 0.1.0
 */
export const hydrate = (
  router: Router.Any,
  queryClient: QueryClient,
  state: DehydratedState | null | undefined,
  options: RpcHydrateOptions = {},
): void => {
  if (state === null || state === undefined || typeof state !== 'object') return;
  const { keyPrefix, ...tanstackOptions } = options;
  const decoded = decodeState(
    ownerOf(router, keyPrefix),
    state,
    deserializerOf(queryClient, tanstackOptions),
  );
  tanstackHydrate(queryClient, decoded, withIdentityDeserializer(tanstackOptions));
};

const makeHydrationBoundary = (owner: Owner): React.FC<RpcHydrationBoundaryProps> => {
  const HydrationBoundary: React.FC<RpcHydrationBoundaryProps> = (props) => {
    const contextClient = useQueryClient(props.queryClient);
    const { state, options } = props;
    const deserializeData = deserializerOf(contextClient, options);
    const decoded = React.useMemo(
      () =>
        state === null || state === undefined || typeof state !== 'object'
          ? state
          : decodeState(owner, state, deserializeData),
      // `deserializeData` is configuration: decode again only for a new state.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [state],
    );
    const boundaryOptions = React.useMemo(() => withIdentityDeserializer(options), [options]);
    return (
      <TanstackHydrationBoundary
        state={decoded}
        options={boundaryOptions}
        {...(props.queryClient !== undefined && { queryClient: props.queryClient })}
      >
        {props.children}
      </TanstackHydrationBoundary>
    );
  };
  HydrationBoundary.displayName = 'RpcHydrationBoundary';
  return HydrationBoundary;
};

/**
 * Creates the schema-aware `dehydrate`, `hydrate` and `HydrationBoundary` for a router, so class
 * instances (`Schema.Class` with methods, `Date` fields, ...) and typed errors survive the server
 * → client JSON round trip.
 *
 * **When to use**
 *
 * Use once per router (module scope) in any SSR setup with TanStack Query: dehydrate on the
 * server, render `HydrationBoundary` on the client. With Next.js or TanStack Start, prefer the
 * helpers of `@effect-trpc/next` / `@effect-trpc/start`, which wire this up.
 *
 * **Details**
 *
 * - `dehydrate(queryClient, options?)` and `hydrate(queryClient, state, options?)` are
 *   {@link dehydrate} / {@link hydrate} with the router (and `keyPrefix`) bound.
 * - `HydrationBoundary` has TanStack's props. It decodes a new `state` once (memoized on `state`)
 *   and hydrates through TanStack's boundary.
 * - A dehydrated `RpcDefect` keeps its message but drops its server-side `cause`.
 *
 * **Gotchas**
 *
 * - Both sides must use helpers for the same router and `keyPrefix`: queries whose procedure the
 *   client's router does not know are dropped and refetched.
 * - Routers sharing one `QueryClient` need distinct `keyPrefix`es (on the options proxy and
 *   here); without prefixes their keys cannot be told apart.
 * - Mixing in TanStack's own `dehydrate` / `HydrationBoundary` for router queries loses the class
 *   instances (data arrives as plain objects and ISO strings).
 *
 * **Example** (Server loader and client page)
 *
 * ```tsx
 * import type { Client } from '@effect-trpc/client';
 * import { query, Router } from '@effect-trpc/core';
 * import { Schema } from 'effect';
 *
 * class Post extends Schema.Class<Post>('Post')({
 *   id: Schema.Number,
 *   title: Schema.String,
 *   createdAt: Schema.Date,
 * }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * import {
 *   createHydrationHelpers,
 *   createRpcOptionsProxy,
 *   type RpcOptionsProxy,
 * } from '@effect-trpc/tanstack-react-query';
 * import { QueryClient, useQuery, type DehydratedState } from '@tanstack/react-query';
 *
 * export const { dehydrate, HydrationBoundary } = createHydrationHelpers(appRouter);
 *
 * // Server (loader / server component): prefetch, then dehydrate to a JSON-safe state.
 * export async function loadPostPage(client: Client<typeof appRouter>, id: number) {
 *   const queryClient = new QueryClient();
 *   const rpc = createRpcOptionsProxy({ client, queryClient });
 *   await queryClient.prefetchQuery(rpc.post.byId.queryOptions({ id }));
 *   return dehydrate(queryClient);
 * }
 *
 * // Client: the hydrated value is a real Post, so `createdAt` is a Date.
 * declare const useRpc: () => RpcOptionsProxy<typeof appRouter>;
 * function PostView({ id }: { id: number }) {
 *   const post = useQuery(useRpc().post.byId.queryOptions({ id }));
 *   return <p>{post.data?.createdAt.toISOString()}</p>;
 * }
 *
 * export function PostPage({ state, id }: { state: DehydratedState; id: number }) {
 *   return (
 *     <HydrationBoundary state={state}>
 *       <PostView id={id} />
 *     </HydrationBoundary>
 *   );
 * }
 * ```
 *
 * @see {@link dehydrate}
 * @see {@link hydrate}
 * @category hydration
 * @since 0.1.0
 */
export const createHydrationHelpers = (
  router: Router.Any,
  options: HydrationHelpersOptions = {},
): HydrationHelpers => {
  const { keyPrefix } = options;
  const bound = keyPrefix === undefined ? {} : { keyPrefix };
  return {
    dehydrate: (queryClient, dehydrateOptions) =>
      dehydrate(router, queryClient, { ...bound, ...dehydrateOptions }),
    hydrate: (queryClient, state, hydrateOptions) =>
      hydrate(router, queryClient, state, { ...bound, ...hydrateOptions }),
    HydrationBoundary: makeHydrationBoundary(ownerOf(router, keyPrefix)),
  };
};
