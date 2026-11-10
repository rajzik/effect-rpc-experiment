/**
 * Public entry of `@rpc-effect/core`: tRPC-style procedures, routers, the client error model and
 * JSON codecs for Effect v4.
 *
 * Everything here is transport-free except `HttpContext`, which reads the HTTP request and sets
 * response headers through `effect/http` (it lives here so router modules need not import the
 * server). `@rpc-effect/server` implements routers built with these APIs, `@rpc-effect/client`
 * calls them and `@rpc-effect/tanstack-react-query` bridges them to TanStack Query; all of them
 * share {@link ClientError} and {@link Codecs}.
 *
 * @since 0.1.0
 */
export { ProcedureKind } from './ProcedureKind.js';
export {
  isProcedureDef,
  mutation,
  query,
  subscription,
  type inferError,
  type inferInput,
  type inferKind,
  type inferOutput,
  type NormalizePayload,
  type PayloadInput,
  type ProcedureDef,
} from './Procedure.js';
export { Procedure, type ProcedureWithHandler } from './ProcedureBuilder.js';
export {
  Router,
  type inferRouterErrors,
  type inferRouterInputs,
  type inferRouterOutputs,
  type ProcedureInfo,
  type RouterService,
} from './Router.js';
export {
  causeToClientError,
  exitToClientError,
  isClientInfrastructureError,
  isRpcClientError,
  RpcDefect,
  RpcInterrupted,
  RpcTransportError,
  type ClientError,
  type ClientInfrastructureError,
} from './ClientError.js';
export * as Codecs from './Codecs.js';
export { HttpContext } from './HttpContext.js';
