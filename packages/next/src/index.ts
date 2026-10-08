// Public API of @effect-trpc/next: Next.js App Router integration (route handler, React Server
// Components + TanStack Query helpers, server actions, client provider).
export { createRouteHandler } from './routeHandler.js';
export type { NextRouteHandlerFn, RouteHandler, RouteHandlerOptions } from './routeHandler.js';
export { makeQueryClient } from './queryClient.js';
export { createRscHelpers } from './rsc.js';
export type {
  CacheFn,
  HydrationBoundaryComponent,
  PrefetchableOptions,
  PrefixFlags,
  RscClientSource,
  RscHandlersSource,
  RscHelpers,
  RscHelpersOptions,
  RscHelpersWithCaller,
} from './rsc.js';
export {
  createServerActionCaller,
  decodeActionResult,
  unwrapActionResult,
} from './serverActions.js';
export type {
  ActionResultTypes,
  EncodedActionResult,
  EncodedCauseReason,
  EncodedExit,
  ErrorAt,
  inferActionClientError,
  inferActionError,
  inferActionOutput,
  OutputAt,
  ServerAction,
  ServerActionAt,
  ServerActionCaller,
  ServerActionCallerOptions,
  ServerActionRecord,
} from './serverActions.js';
export { useServerAction } from './useServerAction.js';
export type {
  ServerActionStatus,
  UseServerActionOptions,
  UseServerActionResult,
} from './useServerAction.js';
export { createNextRpcClient, getBaseUrl } from './client.js';
export type { NextRpcClient, NextRpcClientOptions, NextRpcProviderProps } from './client.js';
export type { ActionPath, InputAt, ProcedureAt } from './types.js';
