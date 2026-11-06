/**
 * Serves `@effect-trpc/core` routers with Effect v4: handlers, HTTP adapters, an in-process
 * caller and middleware.
 *
 * Implement a router with `Handlers.make`, merge in the `Middleware` implementations, then serve
 * the layer with `toWebHandler` (fetch runtimes), `layerHttp` (Effect HTTP apps) or
 * `@effect-trpc/server/node` (`serve` / `runServer`), or call it in-process with `createCaller`.
 * Clients come from `@effect-trpc/client`.
 *
 * @since 0.1.0
 */
export { Handlers } from './Handlers.js';
export {
  layerHttp,
  serializationLayer,
  toHttpLayer,
  toWebHandler,
  type LayerHttpOptions,
  type OnErrorInfo,
  type Serialization,
  type ServerOptions,
  type WebHandler,
  type WebHandlerOptions,
} from './Http.js';
export {
  createCaller,
  type Caller,
  type CallerOptions,
  type CallOptions,
  type EffectProcedure,
  type PromiseCaller,
  type PromiseCallOptions,
  type PromiseProcedure,
} from './Caller.js';
export { Middleware } from './Middleware.js';
