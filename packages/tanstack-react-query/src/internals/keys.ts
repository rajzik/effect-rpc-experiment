import { skipToken } from '@tanstack/react-query';
import type {
  AnyRpcMutationKey,
  AnyRpcQueryKey,
  QueryType,
  RpcMutationKeyWithoutPrefix,
  RpcQueryKeyWithoutPrefix,
  RpcQueryKeyWithPrefix,
} from './types.js';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Some path parts may be dot-separated (`"post.byId"`): split them up. */
const splitPath = (path: ReadonlyArray<string>): string[] =>
  path.flatMap((part) => part.split('.'));

/** Returns `true` for a prefixed key (`[[prefix], path, args]`). */
export const isPrefixedQueryKey = (queryKey: AnyRpcQueryKey): queryKey is RpcQueryKeyWithPrefix =>
  queryKey.length >= 3;

/** The parts of an effect-trpc query key. */
export type ReadQueryKeyResult =
  | {
      readonly type: 'prefixed';
      readonly prefix: string[];
      readonly path: string[];
      readonly args: RpcQueryKeyWithoutPrefix[1];
    }
  | {
      readonly type: 'unprefixed';
      readonly prefix: undefined;
      readonly path: string[];
      readonly args: RpcQueryKeyWithoutPrefix[1];
    };

/** Splits an effect-trpc query key into prefix, path and args (tRPC's `readQueryKey`). */
export const readQueryKey = (queryKey: AnyRpcQueryKey): ReadQueryKeyResult =>
  isPrefixedQueryKey(queryKey)
    ? { type: 'prefixed', prefix: queryKey[0], path: queryKey[1], args: queryKey[2] }
    : { type: 'unprefixed', prefix: undefined, path: queryKey[0], args: queryKey[1] };

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((part) => typeof part === 'string');

/**
 * Parses an arbitrary TanStack query key as an effect-trpc key, or returns `undefined` when it is
 * not one (`["todos"]`, `[["a"], "b"]`, ...). Only keys of a single procedure (with a
 * `type: "query" | "infinite"`) are returned.
 */
export const parseQueryKey = (
  queryKey: ReadonlyArray<unknown>,
):
  | {
      readonly prefix: string | undefined;
      readonly path: string[];
      readonly input: unknown;
      readonly type: 'query' | 'infinite';
    }
  | undefined => {
  const prefixed = queryKey.length === 3;
  if (queryKey.length !== 2 && !prefixed) return undefined;
  let prefix: string | undefined;
  if (prefixed) {
    const first = queryKey[0];
    if (!isStringArray(first) || first.length !== 1) return undefined;
    prefix = first[0];
  }
  const path = queryKey[prefixed ? 1 : 0];
  const args = queryKey[prefixed ? 2 : 1];
  if (!isStringArray(path) || path.length === 0 || !isObject(args)) return undefined;
  const type = args['type'];
  if (type !== 'query' && type !== 'infinite') return undefined;
  return { prefix, path, input: args['input'], type };
};

/**
 * Builds a query key (tRPC's `getQueryKeyInternal`): `[path, { input?, type }]`, `[path]` for
 * `type: "any"` without input, `[]` for the root path; `[[prefix], ...]` with a prefix. `input` is
 * omitted when `undefined` or `skipToken`; infinite keys drop the `cursor` and `direction` of the
 * input.
 */
export const getQueryKeyInternal = (opts: {
  readonly path: ReadonlyArray<string>;
  readonly input?: unknown;
  readonly type: QueryType;
  readonly prefix: string | undefined;
}): AnyRpcQueryKey => {
  const { input, type } = opts;
  const path = splitPath(opts.path);
  const key = ((): RpcQueryKeyWithoutPrefix => {
    if ((input === undefined || input === skipToken) && type === 'any') {
      // `[]` (not `[[]]`) for the root, so that it matches every query (`invalidateQueries()`).
      return path.length > 0 ? [path] : ([] as unknown as RpcQueryKeyWithoutPrefix);
    }
    if (type === 'infinite' && isObject(input) && ('direction' in input || 'cursor' in input)) {
      const { cursor: _cursor, direction: _direction, ...rest } = input;
      return [path, { input: rest, type: 'infinite' }];
    }
    return [
      path,
      {
        ...(input !== undefined && input !== skipToken && { input }),
        ...(type !== 'any' && { type }),
      },
    ];
  })();
  if (opts.prefix !== undefined && opts.prefix !== '') {
    return [[opts.prefix], ...key] as RpcQueryKeyWithPrefix;
  }
  return key;
};

/** Builds a mutation key: `[path]`, or `[[prefix], path]` with a prefix. */
export const getMutationKeyInternal = (opts: {
  readonly path: ReadonlyArray<string>;
  readonly prefix: string | undefined;
}): AnyRpcMutationKey => {
  const key: RpcMutationKeyWithoutPrefix = [splitPath(opts.path)];
  return opts.prefix !== undefined && opts.prefix !== '' ? [[opts.prefix], ...key] : key;
};

/** Resolves a lazy argument (`QueryClient | (() => QueryClient)`). */
export const unwrapLazyArg = <T>(valueOrLazy: T | (() => T)): T =>
  typeof valueOrLazy === 'function' ? (valueOrLazy as () => T)() : valueOrLazy;

/** The `.rpc` metadata of an options object. */
export const createRpcOptionsResult = (path: ReadonlyArray<string>): { path: string } => ({
  path: path.join('.'),
});
