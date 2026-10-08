import { Option, Predicate } from 'effect';
import { RpcGroup } from 'effect/rpc';
import type { Rpc, RpcMiddleware } from 'effect/rpc';
import { addDefMiddleware, compileDef, isProcedureDef } from './Procedure.js';
import type { inferError, inferInput, inferOutput, ProcedureDef } from './Procedure.js';
import type { ProcedureKind } from './ProcedureKind.js';

const TypeId = '~@effect-trpc/core/Router' as const;

/** Router keys that would break proxy-based clients (thenable detection, `Function.prototype`). */
const reservedKeys: ReadonlySet<string> = new Set(['then', 'call', 'apply']);

/** Metadata about one procedure of a router. */
export interface ProcedureInfo {
  /** Path segments in the router record, e.g. `["post", "byId"]`. */
  readonly path: ReadonlyArray<string>;
  /** The rpc tag: the path joined by `"."`, e.g. `"post.byId"`. */
  readonly tag: string;
  readonly kind: ProcedureKind.Value;
  /** The compiled `effect/rpc` rpc (annotated with `ProcedureKind`). */
  readonly rpc: Rpc.AnyWithProps;
}

/**
 * A tRPC-style router: a nested record of procedure definitions (and other routers) compiled to
 * an `effect/rpc` `RpcGroup` whose tags are the dot-joined record paths.
 */
export interface Router<Rec> {
  readonly [TypeId]: typeof TypeId;
  /** The record the router was made from. Nested router values are kept as-is. */
  readonly record: Rec;
  /** The compiled group. Use it with `RpcServer`, `RpcClient`, `RpcTest`, `group.toLayer`, ... */
  readonly group: RpcGroup.RpcGroup<Router.Rpcs<Rec>>;
  /** Procedure metadata keyed by tag, in definition order. */
  readonly procedures: ReadonlyMap<string, ProcedureInfo>;
  /** Returns a new router with `middleware` applied to every procedure (after their own middleware). */
  middleware<M extends RpcMiddleware.AnyService>(
    middleware: M,
  ): Router<Router.WithMiddleware<Rec, M>>;
}

export declare namespace Router {
  /** A router record: procedure definitions, routers or nested records, keyed by path segment. */
  export type Shape = {
    readonly [key: string]: ProcedureDef.Any | Any | Shape;
  };

  /** Any router. */
  export interface Any {
    readonly [TypeId]: typeof TypeId;
    readonly record: Shape;
    readonly group: RpcGroup.Any;
    readonly procedures: ReadonlyMap<string, ProcedureInfo>;
  }

  /** The record of a router type. */
  export type Record<R> = R extends Router<infer Rec> ? Rec : never;

  /**
   * The union of `Rpc`s a router (or router record) compiles to, with literal tags such as
   * `"post.byId"`.
   */
  export type Rpcs<R> = R extends Any
    ? RpcsOf<R['record'], ''>
    : R extends Shape
      ? RpcsOf<R, ''>
      : never;

  /** The union of procedure tags (dot-joined paths) of a router or router record. */
  export type Paths<R> = TagOf<Rpcs<R>>;

  /** Maps every procedure definition in a record (recursively) to the definition with `M` added. */
  export type WithMiddleware<Rec, M extends RpcMiddleware.AnyService> = {
    readonly [K in keyof Rec]: Rec[K] extends ProcedureDef.Any
      ? ProcedureDef.AddMiddleware<Rec[K], M>
      : Rec[K] extends Router<infer Sub>
        ? Router<WithMiddleware<Sub, M>>
        : WithMiddleware<Rec[K], M>;
  };

  /** The record produced by merging two records with disjoint keys. */
  export type Merge<A, B> = {
    readonly [K in keyof A | keyof B]: K extends keyof A ? A[K] : K extends keyof B ? B[K] : never;
  };
}

type RecordOf<R> = R extends Router<infer Rec> ? Rec : R;

type InferField<
  D extends ProcedureDef.Any,
  F extends 'input' | 'output' | 'error',
> = F extends 'input' ? inferInput<D> : F extends 'output' ? inferOutput<D> : inferError<D>;

type MapRouter<Rec, F extends 'input' | 'output' | 'error'> = {
  readonly [K in keyof Rec]: Rec[K] extends ProcedureDef.Any
    ? InferField<Rec[K], F>
    : MapRouter<RecordOf<Rec[K]>, F>;
};

/**
 * The inputs of every procedure of a router, as a nested object mirroring the record
 * (tRPC's `inferRouterInputs`): `inferRouterInputs<typeof appRouter>['post']['byId']`.
 */
export type inferRouterInputs<R> = MapRouter<RecordOf<R>, 'input'>;
/** The outputs of every procedure of a router, as a nested object mirroring the record. */
export type inferRouterOutputs<R> = MapRouter<RecordOf<R>, 'output'>;
/** The typed errors of every procedure of a router, as a nested object mirroring the record. */
export type inferRouterErrors<R> = MapRouter<RecordOf<R>, 'error'>;

type TagOf<R> = R extends { readonly _tag: infer Tag extends string } ? Tag : never;

type RpcsOf<Rec, Prefix extends string> = {
  [K in keyof Rec & string]: Rec[K] extends ProcedureDef.Any
    ? ProcedureDef.ToRpc<Rec[K], `${Prefix}${K}`>
    : Rec[K] extends Router.Any
      ? RpcsOf<Rec[K]['record'], `${Prefix}${K}.`>
      : Rec[K] extends Router.Shape
        ? RpcsOf<Rec[K], `${Prefix}${K}.`>
        : never;
}[keyof Rec & string];

/** Returns `true` when `u` is a router created by `Router.make`. */
const isRouter = (u: unknown): u is Router.Any =>
  Predicate.hasProperty(u, TypeId) && u[TypeId] === TypeId;

const isPlainRecord = (u: unknown): u is Router.Shape => {
  if (typeof u !== 'object' || u === null || Array.isArray(u)) return false;
  const proto: unknown = Object.getPrototypeOf(u);
  return proto === Object.prototype || proto === null;
};

const validateKey = (key: string, path: ReadonlyArray<string>): void => {
  const where = path.length === 0 ? 'the router root' : `"${path.join('.')}"`;
  if (key.length === 0) {
    throw new Error(`Invalid router key at ${where}: keys must be non-empty`);
  }
  if (key.includes('.')) {
    throw new Error(
      `Invalid router key "${key}" at ${where}: keys must not contain "." (nest records instead)`,
    );
  }
  if (reservedKeys.has(key)) {
    throw new Error(`Invalid router key "${key}" at ${where}: "${key}" is reserved`);
  }
};

const collect = (
  record: Router.Shape,
  prefix: ReadonlyArray<string>,
  procedures: Map<string, ProcedureInfo>,
): void => {
  for (const key of Object.keys(record)) {
    validateKey(key, prefix);
    const value: unknown = record[key];
    const path = [...prefix, key];
    if (isProcedureDef(value)) {
      const tag = path.join('.');
      const rpc = compileDef(value, tag);
      procedures.set(tag, { path: Object.freeze(path), tag, kind: value.kind, rpc });
    } else if (isRouter(value)) {
      collect(value.record, path, procedures);
    } else if (isPlainRecord(value)) {
      collect(value, path, procedures);
    } else {
      throw new Error(
        `Invalid router entry at "${path.join('.')}": expected a procedure (query, mutation, subscription), a router or a nested record`,
      );
    }
  }
};

const applyMiddleware = (
  record: Router.Shape,
  middleware: RpcMiddleware.AnyService,
): Router.Shape => {
  const out: { [key: string]: ProcedureDef.Any | Router.Any | Router.Shape } = {};
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (isProcedureDef(value)) {
      out[key] = addDefMiddleware(value, middleware);
    } else if (isRouter(value)) {
      out[key] = (value as Router<Router.Shape>).middleware(middleware) as Router.Any;
    } else if (value !== undefined) {
      out[key] = applyMiddleware(value, middleware);
    }
  }
  return out;
};

/**
 * Creates a router from a nested record of procedure definitions, routers and records.
 *
 * Tags are the record paths joined by `"."`. Throws if a key is empty, contains `"."`, is a
 * reserved word (`then`, `call`, `apply`) or if a value is not a procedure, router or record.
 *
 * ```ts
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post }) },
 * });
 * appRouter.group; // RpcGroup<Rpc<"post.byId", ...>>
 * ```
 */
const make = <const Rec extends Router.Shape>(record: Rec): Router<Rec> => {
  const procedures = new Map<string, ProcedureInfo>();
  collect(record, [], procedures);
  const group = RpcGroup.make(...Array.from(procedures.values(), (info) => info.rpc));
  const router: Router<Rec> = {
    [TypeId]: TypeId,
    record,
    group: group as unknown as RpcGroup.RpcGroup<Router.Rpcs<Rec>>,
    procedures,
    middleware: (middleware) => make(applyMiddleware(record, middleware)) as any,
  };
  return Object.freeze(router);
};

/**
 * Merges two routers into one. Their top-level keys must be disjoint; a shared key throws.
 */
const merge = <A extends Router.Shape, B extends Router.Shape>(
  a: Router<A>,
  b: Router<B>,
): Router<Router.Merge<A, B>> => {
  for (const key of Object.keys(b.record)) {
    if (Object.hasOwn(a.record, key)) {
      throw new Error(`Cannot merge routers: duplicate key "${key}"`);
    }
  }
  return make({ ...a.record, ...b.record } as Router.Merge<A, B> & Router.Shape);
};

/**
 * Looks up a procedure by its path segments (`["post", "byId"]`).
 */
const getByPath = (
  router: Router.Any,
  path: ReadonlyArray<string>,
): Option.Option<ProcedureInfo> =>
  path.length === 0 || path.some((segment) => segment.length === 0 || segment.includes('.'))
    ? Option.none()
    : Option.fromUndefinedOr(router.procedures.get(path.join('.')));

/**
 * Returns the compiled rpc for a tag, precisely typed (`Rpc<"post.byId", ...>`). Useful with
 * `Codecs` and anywhere a single procedure's schemas are needed. Throws for an unknown tag.
 */
const getRpc = <R extends Router.Any, const Tag extends Router.Paths<R>>(
  router: R,
  tag: Tag,
): Rpc.ExtractTag<Router.Rpcs<R>, Tag> => {
  const info = router.procedures.get(tag);
  if (info === undefined) {
    throw new Error(`Unknown procedure "${String(tag)}"`);
  }
  return info.rpc as unknown as Rpc.ExtractTag<Router.Rpcs<R>, Tag>;
};

/** Router constructors and helpers. */
export const Router = {
  make,
  merge,
  getByPath,
  getRpc,
  isRouter,
} as const;
