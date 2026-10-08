import { Effect } from 'effect';
import type { Layer, Scope, Stream } from 'effect';
import type { Rpc, RpcGroup } from 'effect/rpc';
import type { ProcedureDef, Router } from '@effect-trpc/core';

type RecordOf<R> = R extends Router<infer Rec> ? Rec : R;

type NestedFrom<Rec, Prefix extends string> = {
  readonly [K in keyof Rec & string]: Rec[K] extends ProcedureDef.Any
    ? Rpc.ToHandlerFn<ProcedureDef.ToRpc<Rec[K], `${Prefix}${K}`>>
    : NestedFrom<RecordOf<Rec[K]>, `${Prefix}${K}.`>;
};

type ResultServices<Result> =
  Result extends Rpc.Wrapper<infer Inner>
    ? ResultServices<Inner>
    : Result extends Effect.Effect<infer _A, infer _E, infer R>
      ? R
      : Result extends Stream.Stream<infer _A, infer _E, infer R>
        ? R
        : never;

type HandlerServices<Current extends Rpc.Any, Handler> =
  Current extends Rpc.Rpc<
    infer Tag,
    infer _Payload,
    infer _Success,
    infer _Error,
    infer _Middleware,
    infer Requires
  >
    ?
        | Exclude<
            Rpc.ExcludeProvides<
              Handler extends (...args: ReadonlyArray<never>) => infer Result
                ? ResultServices<Result>
                : never,
              Current,
              Tag
            >,
            Scope.Scope
          >
        | Requires
    : never;

type NestedServices<Rec, H, Prefix extends string> = {
  [K in keyof H & string]: K extends keyof Rec
    ? Rec[K] extends ProcedureDef.Any
      ? HandlerServices<ProcedureDef.ToRpc<Rec[K], `${Prefix}${K}`>, H[K]>
      : NestedServices<RecordOf<Rec[K]>, H[K], `${Prefix}${K}.`>
    : never;
}[keyof H & string];

/** Handler constructors for a core `Router`. */
export declare namespace Handlers {
  /**
   * The nested handler record of a router: it mirrors the router record, and every procedure maps
   * to an `effect/rpc` handler function `(payload, ctx) => Effect | Stream`, where
   * `ctx = { client, requestId, headers, rpc }`.
   *
   * Queries and mutations return an `Effect` of the success value; subscriptions return a
   * `Stream` of elements (or an `Effect` of a `Queue.Dequeue`).
   */
  export type From<R extends Router.Any> = NestedFrom<R['record'], ''>;

  /** The tag-keyed handler record (`{ "post.byId": (payload, ctx) => ... }`). */
  export type Flat<R extends Router.Any> = RpcGroup.HandlersFrom<Router.Rpcs<R>>;

  /**
   * The services required by a nested handler record `H` for router `R`, excluding the services
   * provided by middleware (e.g. `CurrentUser`) and `Scope`.
   */
  export type Services<R extends Router.Any, H> = NestedServices<R['record'], H, ''>;

  /** The handler services a router needs: one `Rpc.Handler<Tag>` per procedure. */
  export type Provides<R extends Router.Any> = Rpc.ToHandler<Router.Rpcs<R>>;

  /**
   * Everything an rpc server for router `R` needs from the environment: the handlers, the server
   * implementations of the router's middleware and the services required by its schemas.
   */
  export type Requirements<R extends Router.Any> =
    | Rpc.ToHandler<Router.Rpcs<R>>
    | Rpc.Middleware<Router.Rpcs<R>>
    | Rpc.ServicesServer<Router.Rpcs<R>>;
}

type AnyHandler = (...args: ReadonlyArray<never>) => unknown;

const isRecord = (u: unknown): u is { readonly [key: string]: unknown } =>
  typeof u === 'object' && u !== null;

/**
 * Converts a nested handler record to the tag-keyed record expected by `RpcGroup.toLayer`.
 * Throws when a procedure has no handler.
 */
const flatten = (router: Router.Any, nested: unknown): { readonly [tag: string]: AnyHandler } => {
  const out: { [tag: string]: AnyHandler } = {};
  for (const info of router.procedures.values()) {
    let node: unknown = nested;
    for (const segment of info.path) {
      node = isRecord(node) && Object.hasOwn(node, segment) ? node[segment] : undefined;
    }
    if (typeof node !== 'function') {
      throw new Error(`Missing handler for procedure "${info.tag}"`);
    }
    out[info.tag] = node as AnyHandler;
  }
  return out;
};

/** Flattens a nested record, or an Effect producing one (a missing handler is then a defect). */
const flattenBuild = (router: Router.Any, build: unknown): unknown =>
  Effect.isEffect(build)
    ? Effect.flatMap(build, (nested) =>
        Effect.try({ try: () => flatten(router, nested), catch: (cause) => cause }).pipe(
          Effect.orDie,
        ),
      )
    : flatten(router, build);

const toLayer = (router: Router.Any, handlers: unknown): Layer.Layer<never, unknown, unknown> =>
  (
    router.group as unknown as {
      readonly toLayer: (build: unknown) => Layer.Layer<never, unknown, unknown>;
    }
  ).toLayer(handlers);

/**
 * Implements every procedure of a router from a nested handler record mirroring the router
 * record, returning the handler layer (`Layer<Rpc.ToHandler<...>>`) consumed by `RpcServer`,
 * `RpcTest.makeClient`, `toWebHandler`, `createCaller`, ...
 *
 * `build` is either the record itself or an `Effect` producing it (for handlers that need
 * services at construction time). Each handler receives the decoded payload and the
 * `effect/rpc` handler context `{ client, requestId, headers, rpc }`.
 *
 * ```ts
 * const HandlersLive = Handlers.make(appRouter, {
 *   post: {
 *     byId: ({ id }, { headers }) => Effect.succeed(new Post({ id, title: headers['x-title'] ?? '' })),
 *   },
 * });
 * ```
 *
 * A missing handler or a handler with the wrong payload / success / error type is a compile
 * error. At runtime a missing handler throws (or fails the layer when `build` is an Effect).
 */
const make = <R extends Router.Any, H extends Handlers.From<R>, EX = never, RX = never>(
  router: R,
  build: H | Effect.Effect<H, EX, RX>,
): Layer.Layer<Handlers.Provides<R>, EX, Exclude<RX, Scope.Scope> | Handlers.Services<R, H>> =>
  toLayer(router, flattenBuild(router, build)) as Layer.Layer<
    Handlers.Provides<R>,
    EX,
    Exclude<RX, Scope.Scope> | Handlers.Services<R, H>
  >;

/**
 * Implements every procedure of a router from a tag-keyed handler record
 * (`{ "post.byId": ... }`). Equivalent to `router.group.toLayer(handlers)`.
 */
const flat = <R extends Router.Any, H extends Handlers.Flat<R>, EX = never, RX = never>(
  router: R,
  build: H | Effect.Effect<H, EX, RX>,
): Layer.Layer<
  Handlers.Provides<R>,
  EX,
  Exclude<RX, Scope.Scope> | RpcGroup.HandlersServices<Router.Rpcs<R>, H>
> =>
  toLayer(router, build) as Layer.Layer<
    Handlers.Provides<R>,
    EX,
    Exclude<RX, Scope.Scope> | RpcGroup.HandlersServices<Router.Rpcs<R>, H>
  >;

/**
 * Identity helper that type-checks (and contextually types) a nested handler record against a
 * router, e.g. to define handlers in a separate module or inside `Effect.gen`.
 */
const of = <R extends Router.Any, H extends Handlers.From<R>>(_router: R, handlers: H): H =>
  handlers;

/** Handler constructors for a core `Router`. */
export const Handlers = {
  make,
  flat,
  of,
} as const;
