import { Predicate, Schema } from 'effect';
import { Rpc } from 'effect/rpc';
import type { RpcMiddleware, RpcSchema } from 'effect/rpc';
import { ProcedureKind } from './ProcedureKind.js';

const TypeId = '~@effect-trpc/core/ProcedureDef' as const;

/** A payload may be given as a schema or as `Schema.Struct` fields. */
export type PayloadInput = Schema.Top | Schema.Struct.Fields;

/** Normalizes a {@link PayloadInput} to a schema (struct fields become a `Schema.Struct`). */
export type NormalizePayload<P> = P extends Schema.Struct.Fields ? Schema.Struct<P> : P;

/**
 * A procedure definition: the schemas and kind of one tRPC-style procedure, without a tag.
 *
 * The tag (`"post.byId"`) is assigned by `Router.make` from the procedure's path in the router
 * record. Definitions are immutable; `.middleware(M)` returns a new definition.
 *
 * - `Payload` – input schema (`Schema.Void` when the procedure takes no input)
 * - `Success` – output schema; for subscriptions this is the schema of each streamed element
 * - `Error` – typed failure schema (`Schema.Never` when the procedure cannot fail)
 * - `Middleware` / `Requires` – `effect/rpc` middleware applied to the compiled rpc
 */
export interface ProcedureDef<
  Kind extends ProcedureKind.Value,
  Payload extends Schema.Top = Schema.Void,
  Success extends Schema.Top = Schema.Void,
  Error extends Schema.Top = Schema.Never,
  Middleware extends RpcMiddleware.AnyService = never,
  Requires = never,
> {
  readonly [TypeId]: typeof TypeId;
  readonly kind: Kind;
  readonly payloadSchema: Payload;
  readonly successSchema: Success;
  readonly errorSchema: Error;
  /** Middleware in application order. */
  readonly middlewares: ReadonlyArray<RpcMiddleware.AnyService>;
  /**
   * Type-level only (always `undefined` at runtime). Use `inferInput`, `inferOutput`,
   * `inferError` and `inferKind` instead of reading it directly.
   */
  readonly '~types'?: ProcedureDef.Types<Kind, Payload, Success, Error, Middleware>;
  /** Returns a new definition with `middleware` added (applied after existing middleware). */
  middleware<M extends RpcMiddleware.AnyService>(
    middleware: M,
  ): ProcedureDef<
    Kind,
    Payload,
    Success,
    Error,
    Middleware | M,
    RpcMiddleware.ApplyServices<M['Identifier'], Requires>
  >;
  /** Compiles the definition to an `effect/rpc` `Rpc` with the given tag. */
  toRpc<const Tag extends string>(
    tag: Tag,
  ): ProcedureDef.ToRpc<ProcedureDef<Kind, Payload, Success, Error, Middleware, Requires>, Tag>;
}

export declare namespace ProcedureDef {
  /**
   * Any procedure definition. Deliberately minimal: it only brands the value, so that inline
   * definitions inside `Router.make({...})` infer their own schemas instead of `Schema.Top`.
   */
  export interface Any {
    readonly [TypeId]: typeof TypeId;
    readonly kind: ProcedureKind.Value;
  }

  /** The decoded types carried by a definition. */
  export interface Types<
    Kind extends ProcedureKind.Value,
    Payload extends Schema.Top,
    Success extends Schema.Top,
    Error extends Schema.Top,
    Middleware extends RpcMiddleware.AnyService,
  > {
    readonly kind: Kind;
    readonly input: Payload['Type'];
    /** For subscriptions: the type of each streamed element. */
    readonly output: Success['Type'];
    /** Procedure errors plus the errors declared by its middleware. */
    readonly error: Error['Type'] | Middleware['error']['Type'];
  }

  /** Adds middleware `M` to a definition type. */
  export type AddMiddleware<D, M extends RpcMiddleware.AnyService> =
    D extends ProcedureDef<infer K, infer P, infer S, infer E, infer Mw, infer Rq>
      ? ProcedureDef<K, P, S, E, Mw | M, RpcMiddleware.ApplyServices<M['Identifier'], Rq>>
      : never;

  /**
   * The `Rpc` a definition compiles to under `Tag`. Subscriptions become streaming rpcs
   * (`RpcSchema.Stream<Success, Error>` success and a `Schema.Never` rpc error).
   */
  export type ToRpc<D, Tag extends string> =
    D extends ProcedureDef<infer K, infer P, infer S, infer E, infer Mw, infer Rq>
      ? K extends 'subscription'
        ? Rpc.Rpc<Tag, P, RpcSchema.Stream<S, E>, Schema.Never, Mw, Rq>
        : Rpc.Rpc<Tag, P, S, E, Mw, Rq>
      : never;
}

/** The decoded input (payload) type of a procedure definition. `void` when it takes no input. */
export type inferInput<D extends ProcedureDef.Any> = TypesOf<D>['input'];
/** The decoded output type of a procedure definition (the element type for subscriptions). */
export type inferOutput<D extends ProcedureDef.Any> = TypesOf<D>['output'];
/** The typed error of a procedure definition, including errors declared by its middleware. */
export type inferError<D extends ProcedureDef.Any> = TypesOf<D>['error'];
/** The kind (`"query" | "mutation" | "subscription"`) of a procedure definition. */
export type inferKind<D extends ProcedureDef.Any> = D['kind'];

type TypesOf<D> =
  D extends ProcedureDef<infer K, infer P, infer S, infer E, infer M, infer _Rq>
    ? ProcedureDef.Types<K, P, S, E, M>
    : never;

/** Returns `true` when `u` is a procedure definition created by `query`, `mutation` or `subscription`. */
export const isProcedureDef = (u: unknown): u is ProcedureDef.Any =>
  Predicate.hasProperty(u, TypeId) && u[TypeId] === TypeId;

interface DefState {
  readonly kind: ProcedureKind.Value;
  readonly payloadSchema: Schema.Top;
  readonly successSchema: Schema.Top;
  readonly errorSchema: Schema.Top;
  readonly middlewares: ReadonlyArray<RpcMiddleware.AnyService>;
}

type AnyRpc = Rpc.Rpc<string, Schema.Top, Schema.Top, Schema.Top, any, any>;

class ProcedureDefImpl implements DefState {
  readonly [TypeId] = TypeId;
  readonly kind: ProcedureKind.Value;
  readonly payloadSchema: Schema.Top;
  readonly successSchema: Schema.Top;
  readonly errorSchema: Schema.Top;
  readonly middlewares: ReadonlyArray<RpcMiddleware.AnyService>;

  constructor(state: DefState) {
    this.kind = state.kind;
    this.payloadSchema = state.payloadSchema;
    this.successSchema = state.successSchema;
    this.errorSchema = state.errorSchema;
    this.middlewares = Object.freeze([...state.middlewares]);
    Object.freeze(this);
  }

  middleware(middleware: RpcMiddleware.AnyService): ProcedureDefImpl {
    return new ProcedureDefImpl({
      kind: this.kind,
      payloadSchema: this.payloadSchema,
      successSchema: this.successSchema,
      errorSchema: this.errorSchema,
      middlewares: [...this.middlewares, middleware],
    });
  }

  toRpc(tag: string): AnyRpc {
    let rpc: AnyRpc = Rpc.make(tag, {
      payload: this.payloadSchema,
      success: this.successSchema,
      error: this.errorSchema,
      stream: this.kind === 'subscription',
    });
    for (const middleware of this.middlewares) {
      rpc = rpc.middleware(middleware);
    }
    return rpc.annotate(ProcedureKind, this.kind);
  }
}

const normalizePayload = (payload: PayloadInput | undefined): Schema.Top =>
  payload === undefined ? Schema.Void : Schema.isSchema(payload) ? payload : Schema.Struct(payload);

/** @internal Compiles any definition (used by `Router`). */
export const compileDef = (def: ProcedureDef.Any, tag: string): Rpc.AnyWithProps =>
  (def as ProcedureDefImpl).toRpc(tag);

/** @internal Adds middleware to any definition (used by `Router`). */
export const addDefMiddleware = (
  def: ProcedureDef.Any,
  middleware: RpcMiddleware.AnyService,
): ProcedureDef.Any => (def as ProcedureDefImpl).middleware(middleware);

// Returns `any`: the builders below assign the precise `ProcedureDef<...>` type.
const define = (
  kind: ProcedureKind.Value,
  options: {
    readonly payload?: PayloadInput;
    readonly success?: Schema.Top;
    readonly error?: Schema.Top;
  },
): any =>
  new ProcedureDefImpl({
    kind,
    payloadSchema: normalizePayload(options.payload),
    successSchema: options.success ?? Schema.Void,
    errorSchema: options.error ?? Schema.Never,
    middlewares: [],
  });

/**
 * Defines a query procedure (a read; maps to tRPC's `.query()`).
 *
 * ```ts
 * const byId = query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound });
 * ```
 */
export const query = <
  P extends PayloadInput = Schema.Void,
  S extends Schema.Top = Schema.Void,
  E extends Schema.Top = Schema.Never,
>(
  options: {
    readonly payload?: P;
    readonly success?: S;
    readonly error?: E;
  } = {},
): ProcedureDef<'query', NormalizePayload<P>, S, E> => define('query', options);

/** Defines a mutation procedure (a write; maps to tRPC's `.mutation()`). */
export const mutation = <
  P extends PayloadInput = Schema.Void,
  S extends Schema.Top = Schema.Void,
  E extends Schema.Top = Schema.Never,
>(
  options: {
    readonly payload?: P;
    readonly success?: S;
    readonly error?: E;
  } = {},
): ProcedureDef<'mutation', NormalizePayload<P>, S, E> => define('mutation', options);

/**
 * Defines a subscription procedure: a server stream of `success` elements that may fail with
 * `error`. Compiles to `Rpc.make(tag, { stream: true, ... })`.
 */
export const subscription = <
  P extends PayloadInput = Schema.Void,
  S extends Schema.Top = Schema.Void,
  E extends Schema.Top = Schema.Never,
>(options: {
  readonly payload?: P;
  readonly success: S;
  readonly error?: E;
}): ProcedureDef<'subscription', NormalizePayload<P>, S, E> => define('subscription', options);
