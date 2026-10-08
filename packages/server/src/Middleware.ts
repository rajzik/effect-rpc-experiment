import type { Schema } from 'effect';
import { RpcMiddleware as EffectRpcMiddleware } from 'effect/rpc';

/**
 * `effect/rpc`'s `RpcMiddleware` module, re-exported as `Middleware`, plus {@link make}.
 *
 * A middleware is a service class; attach it to procedures with `.middleware(M)` (or to a whole
 * router with `router.middleware(M)`) and implement it on the server with
 * `Layer.succeed(M)(M.of((effect, { headers, rpc, payload, requestId, client }) => ...))`.
 * Middleware that `provides` a service (e.g. `CurrentUser`) makes it available to handlers, which
 * read it with `yield* CurrentUser`.
 */
export const Middleware = {
  ...EffectRpcMiddleware,
  /**
   * Declares a middleware service class. Alias of `RpcMiddleware.Service`:
   *
   * ```ts
   * class Auth extends Middleware.make<Auth, { provides: CurrentUser }>()('Auth', {
   *   error: Unauthorized,
   * }) {}
   * ```
   *
   * `Config` may declare `provides` (services provided to handlers), `requires` (services the
   * middleware needs) and `clientError`. Options: `error` (typed failure schema, added to the
   * error type of every procedure using it) and `requiredForClient` (clients must provide a
   * client-side implementation via `Middleware.layerClient`).
   */
  make: EffectRpcMiddleware.Service,
} as const;

export declare namespace Middleware {
  /** The server implementation function of a middleware. */
  export type RpcMiddleware<P, E, Rq> = EffectRpcMiddleware.RpcMiddleware<P, E, Rq>;
  /** The client implementation function of a middleware. */
  export type RpcMiddlewareClient<E, CE, R> = EffectRpcMiddleware.RpcMiddlewareClient<E, CE, R>;
  /** Any middleware service class. */
  export type AnyService = EffectRpcMiddleware.AnyService;
  /** Any middleware identifier. */
  export type AnyId = EffectRpcMiddleware.AnyId;
  /** The service class created by `Middleware.make`. */
  export type ServiceClass<
    Self,
    Name extends string,
    P,
    E extends Schema.Constraint,
    ClientError,
    Rq,
    RequiredForClient extends boolean,
  > = EffectRpcMiddleware.ServiceClass<Self, Name, P, E, ClientError, Rq, RequiredForClient>;
  /** The services provided by a middleware. */
  export type Provides<A> = EffectRpcMiddleware.Provides<A>;
  /** The services required by a middleware. */
  export type Requires<A> = EffectRpcMiddleware.Requires<A>;
  /** The typed error of a middleware. */
  export type Error<A> = EffectRpcMiddleware.Error<A>;
  /** The client implementation marker service of a middleware. */
  export type ForClient<Id> = EffectRpcMiddleware.ForClient<Id>;
}
