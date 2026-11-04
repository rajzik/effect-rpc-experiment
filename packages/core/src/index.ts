/**
 * Public entry of `@effect-trpc/core`: tRPC-style procedures, routers, the client error model and
 * JSON codecs for Effect v4.
 *
 * Everything here is transport-free. `@effect-trpc/server` implements routers built with these
 * APIs, `@effect-trpc/client` calls them and `@effect-trpc/tanstack-react-query` bridges them to
 * TanStack Query; all of them share {@link ClientError} and {@link Codecs}.
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
export {
  Router,
  type inferRouterErrors,
  type inferRouterInputs,
  type inferRouterOutputs,
  type ProcedureInfo,
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
