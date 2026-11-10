/**
 * Re-exports `effect/rpc`'s `RpcMiddleware` module as `Middleware`, plus `Middleware.make`.
 *
 * Middleware is how effect-trpc does auth and request context: a middleware is a service class
 * attached to procedures (`query(...).middleware(Auth)`) or routers (`router.middleware(Auth)`)
 * in `@rpc-effect/core`; its server implementation is a `Layer` merged with the handler layer
 * from `Handlers.make`.
 *
 * @since 0.1.0
 */
import type { Schema } from 'effect';
import { RpcMiddleware as EffectRpcMiddleware } from 'effect/rpc';

/**
 * `effect/rpc`'s `RpcMiddleware` module, re-exported as `Middleware`, plus `Middleware.make`
 * (an alias of `RpcMiddleware.Service`).
 *
 * **When to use**
 *
 * Use for cross-cutting concerns that run before handlers: authentication, authorization,
 * tenancy, timing. A middleware can fail with a typed error (added to the error type of every
 * procedure using it) and can provide services (e.g. `CurrentUser`) that handlers read with
 * `yield* CurrentUser`.
 *
 * **Details**
 *
 * - Implement it on the server with
 *   `Layer.succeed(M)(M.of((effect, { headers, rpc, payload, requestId, client }) => ...))`.
 * - Middleware added later wraps the middleware added before it, so it runs first:
 *   `query(...).middleware(Authz).middleware(Authn)` runs `Authn`, then `Authz`.
 * - `requiredForClient: true` middleware also needs a client implementation
 *   (`Middleware.layerClient(M, ...)`), passed to `createClient({ middleware })` or included in
 *   the `createCaller` handler layer.
 *
 * **Gotchas**
 *
 * - The implementation layer is not part of `Handlers.make(...)`; provide both:
 *   `Layer.mergeAll(HandlersLive, AuthLive)`. A missing implementation is a compile error for
 *   `toWebHandler`, `createCaller` and `serve`.
 * - Provide the declared service with `Effect.provideService(effect, CurrentUser, value)` on
 *   the `effect` argument; handlers then read it with `yield* CurrentUser`.
 *
 * **Example** (Header-based authentication providing the current user)
 *
 * ```ts
 * import { Context, Effect, Layer, Schema } from 'effect';
 * import { query, Router } from '@rpc-effect/core';
 * import { createCaller, Handlers, Middleware } from '@rpc-effect/server';
 *
 * class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}
 * class CurrentUser extends Context.Service<CurrentUser, { readonly name: string }>()(
 *   'CurrentUser',
 * ) {}
 *
 * class Auth extends Middleware.make<Auth, { provides: CurrentUser }>()('Auth', {
 *   error: Unauthorized,
 * }) {}
 *
 * const AuthLive = Layer.succeed(Auth)(
 *   Auth.of((effect, { headers }) => {
 *     const name = headers['x-user'];
 *     return name === undefined
 *       ? Effect.fail(new Unauthorized())
 *       : Effect.provideService(effect, CurrentUser, { name });
 *   }),
 * );
 *
 * const appRouter = Router.make({
 *   whoami: query({ success: Schema.String }).middleware(Auth),
 * });
 * const HandlersLive = Handlers.make(appRouter, {
 *   whoami: () =>
 *     Effect.gen(function* () {
 *       const user = yield* CurrentUser;
 *       return user.name;
 *     }),
 * });
 *
 * const caller = createCaller(appRouter, { handlers: Layer.mergeAll(HandlersLive, AuthLive) });
 * // Effect<string, Unauthorized>: the middleware error is part of the procedure's errors.
 * const whoami = caller.whoami(undefined, { headers: { 'x-user': 'ada' } });
 * ```
 *
 * @see {@link Handlers}
 * @category constructors
 * @since 0.1.0
 */
export const Middleware = {
  ...EffectRpcMiddleware,
  /**
   * Declares a middleware service class. Alias of `RpcMiddleware.Service`.
   *
   * **Details**
   *
   * - `Config` may declare `provides` (services provided to handlers), `requires` (services the
   *   middleware needs) and `clientError`.
   * - Options: `error` (typed failure schema, added to the error type of every procedure using
   *   it) and `requiredForClient` (clients must provide a client-side implementation via
   *   `Middleware.layerClient`).
   *
   * **Example** (Declaring an auth middleware)
   *
   * ```ts
   * import { Context, Schema } from 'effect';
   * import { Middleware } from '@rpc-effect/server';
   *
   * class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}
   * class CurrentUser extends Context.Service<CurrentUser, { readonly name: string }>()(
   *   'CurrentUser',
   * ) {}
   *
   * class Auth extends Middleware.make<Auth, { provides: CurrentUser }>()('Auth', {
   *   error: Unauthorized,
   * }) {}
   * ```
   *
   * @since 0.1.0
   */
  make: EffectRpcMiddleware.Service,
} as const;

/**
 * Type aliases of `effect/rpc`'s `RpcMiddleware` types, under the `Middleware` name.
 *
 * @category type-level
 * @since 0.1.0
 */
export declare namespace Middleware {
  /**
   * The server implementation function of a middleware.
   *
   * @since 0.1.0
   */
  export type RpcMiddleware<P, E, Rq> = EffectRpcMiddleware.RpcMiddleware<P, E, Rq>;
  /**
   * The client implementation function of a middleware.
   *
   * @since 0.1.0
   */
  export type RpcMiddlewareClient<E, CE, R> = EffectRpcMiddleware.RpcMiddlewareClient<E, CE, R>;
  /**
   * Any middleware service class.
   *
   * @since 0.1.0
   */
  export type AnyService = EffectRpcMiddleware.AnyService;
  /**
   * Any middleware identifier.
   *
   * @since 0.1.0
   */
  export type AnyId = EffectRpcMiddleware.AnyId;
  /**
   * The service class created by `Middleware.make`.
   *
   * @since 0.1.0
   */
  export type ServiceClass<
    Self,
    Name extends string,
    P,
    E extends Schema.Constraint,
    ClientError,
    Rq,
    RequiredForClient extends boolean,
  > = EffectRpcMiddleware.ServiceClass<Self, Name, P, E, ClientError, Rq, RequiredForClient>;
  /**
   * The services provided by a middleware.
   *
   * @since 0.1.0
   */
  export type Provides<A> = EffectRpcMiddleware.Provides<A>;
  /**
   * The services required by a middleware.
   *
   * @since 0.1.0
   */
  export type Requires<A> = EffectRpcMiddleware.Requires<A>;
  /**
   * The typed error of a middleware.
   *
   * @since 0.1.0
   */
  export type Error<A> = EffectRpcMiddleware.Error<A>;
  /**
   * The client implementation marker service of a middleware.
   *
   * @since 0.1.0
   */
  export type ForClient<Id> = EffectRpcMiddleware.ForClient<Id>;
}
