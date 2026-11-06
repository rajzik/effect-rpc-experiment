/**
 * Next.js App Router integration for effect-trpc: route handler, React Server Components +
 * TanStack Query helpers, server actions with typed errors, and the client provider.
 *
 * Server-only entry points: `createRouteHandler` (`app/api/rpc/[[...rpc]]/route.ts`),
 * `createRscHelpers` (`trpc/server.tsx`) and `createServerActionCaller` (`'use server'` files).
 * Client entry points: `createNextRpcClient` (`'use client'` `trpc/client.tsx`) and
 * `useServerAction`. `makeQueryClient`, `getBaseUrl`, `decodeActionResult` and
 * `unwrapActionResult` work on both sides. Everything is exported from this single entry; the
 * package has no `'use client'` / `'use server'` directives of its own.
 *
 * @since 0.1.0
 */
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
