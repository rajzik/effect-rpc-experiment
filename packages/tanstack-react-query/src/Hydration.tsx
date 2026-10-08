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

/** Options of `dehydrate`: TanStack's options plus `dehydrateErrors`. */
export interface RpcDehydrateOptions extends DehydrateOptions {
  /**
   * Also dehydrate failed queries of the router, encoding their `ClientError` (typed errors and
   * `RpcDefect` / `RpcTransportError` / `RpcInterrupted`) so that `hydrate` restores the class
   * instance. Default `true`.
   */
  readonly dehydrateErrors?: boolean | undefined;
}

/** Props of the effect-trpc `HydrationBoundary`: the same as TanStack's. */
export type RpcHydrationBoundaryProps = HydrationBoundaryProps;

/** Dehydration helpers bound to a router; see {@link createHydrationHelpers}. */
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
    options?: HydrateOptions,
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

const lookup = (router: Router.Any, queryKey: ReadonlyArray<unknown>) => {
  const parsed = parseQueryKey(queryKey);
  if (parsed === undefined) return undefined;
  const info = router.procedures.get(parsed.path.join('.'));
  if (info === undefined || info.kind !== 'query') return undefined;
  return { info, type: parsed.type };
};

/**
 * TanStack's `dehydrate` for a router: the data of every query of the router is encoded with
 * `Codecs.success(rpc)` (each page for infinite queries) and, unless `dehydrateErrors: false`,
 * failed queries are included with their error encoded through `Codecs.exit(rpc)`. Queries with
 * other keys are dehydrated unchanged. A query whose value cannot be encoded is left out (the
 * client will fetch it).
 */
export const dehydrate = (
  router: Router.Any,
  queryClient: QueryClient,
  options: RpcDehydrateOptions = {},
): DehydratedState => {
  const { dehydrateErrors = true, ...rest } = options;
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
        lookup(router, query.queryKey) !== undefined),
    shouldRedactErrors:
      rest.shouldRedactErrors ?? defaults?.shouldRedactErrors ?? redactUnlessTypedError,
  });
  const queries = state.queries.flatMap((query): Array<MarkedQuery> => {
    const found = lookup(router, query.queryKey);
    if (found === undefined) {
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
  router: Router.Any,
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
    const found = lookup(router, query.queryKey);
    // Encoded by a router that has this procedure while this one does not: let the client fetch.
    if (found === undefined) return [];
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
 * `Codecs.success`, errors with `Codecs.exit`) back to class instances, then hydrates.
 */
export const hydrate = (
  router: Router.Any,
  queryClient: QueryClient,
  state: DehydratedState | null | undefined,
  options?: HydrateOptions,
): void => {
  if (state === null || state === undefined || typeof state !== 'object') return;
  const decoded = decodeState(router, state, deserializerOf(queryClient, options));
  tanstackHydrate(queryClient, decoded, withIdentityDeserializer(options));
};

const makeHydrationBoundary = (router: Router.Any): React.FC<RpcHydrationBoundaryProps> => {
  const HydrationBoundary: React.FC<RpcHydrationBoundaryProps> = (props) => {
    const contextClient = useQueryClient(props.queryClient);
    const { state, options } = props;
    const deserializeData = deserializerOf(contextClient, options);
    const decoded = React.useMemo(
      () =>
        state === null || state === undefined || typeof state !== 'object'
          ? state
          : decodeState(router, state, deserializeData),
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
 * Schema-aware SSR hydration for a router. Class instances (`Schema.Class` with methods, `Date`
 * fields, ...) and typed errors survive the server → client JSON round trip:
 *
 * ```tsx
 * const { dehydrate, hydrate, HydrationBoundary } = createHydrationHelpers(appRouter);
 * // server
 * await queryClient.prefetchQuery(rpc.post.byId.queryOptions({ id: 1 }));
 * const state = dehydrate(queryClient); // JSON-safe
 * // client
 * <HydrationBoundary state={state}><Post /></HydrationBoundary>
 * ```
 */
export const createHydrationHelpers = (router: Router.Any): HydrationHelpers => ({
  dehydrate: (queryClient, options) => dehydrate(router, queryClient, options),
  hydrate: (queryClient, state, options) => hydrate(router, queryClient, state, options),
  HydrationBoundary: makeHydrationBoundary(router),
});
