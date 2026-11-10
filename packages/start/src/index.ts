/**
 * `@rpc-effect/start` — TanStack Start integration: a server route handler, an isomorphic client
 * and loader / hydration helpers for TanStack Query.
 *
 * Server-only: `createStartHandler` (`src/routes/api/rpc.$.ts`) and `createServerClient`
 * (in-process `localLink`). Browser: `createBrowserClient` (`httpLink`). Both sides:
 * `createIsomorphicClient`, `createStartHelpers`, `createStartHydration`, `getBaseUrl`,
 * `getRpcUrl`. `@tanstack/react-start` is only imported as types, so the package has no Start
 * runtime dependency.
 *
 * @since 0.1.0
 */
export {
  createStartHandler,
  defaultStartPath,
  type StartHandler,
  type StartHandlerContext,
  type StartHandlerOptions,
} from './handler.js';
export {
  createBrowserClient,
  createIsomorphicClient,
  createServerClient,
  getBaseUrl,
  getRpcUrl,
  type BaseUrlOptions,
  type BrowserClientOptions,
  type IsomorphicClientOptions,
  type ServerClientOptions,
} from './client.js';
export {
  createStartHelpers,
  createStartHydration,
  type StartDehydratedQueries,
  type StartHelpers,
  type StartHelpersOptions,
  type StartHydration,
  type StartRouterHydrationOptions,
} from './helpers.js';
