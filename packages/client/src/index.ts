/**
 * Typed clients for `@effect-trpc/core` routers: Promise and Effect APIs over pluggable links.
 *
 * `createClient(router, { link })` is the entry point; links are `httpLink` (fetch + NDJSON),
 * `httpBatchLink` (same-tick queries in one POST), `wsLink` (one WebSocket), `localLink`
 * (in-process) or a custom `Link`. The client error types (`RpcDefect`, `RpcTransportError`,
 * `RpcInterrupted`, `ClientError`) are re-exported from `@effect-trpc/core`. Servers come from
 * `@effect-trpc/server`.
 *
 * @since 0.1.0
 */
export {
  Link,
  httpBatchLink,
  httpLink,
  localLink,
  wsLink,
  type HeadersOption,
  type HttpBatchLinkOptions,
  type HttpLinkOptions,
  type LocalLinkOptions,
  type SerializationOption,
  type WsLinkOptions,
} from './Link.js';
export {
  createClient,
  type CallArgs,
  type Client,
  type ClientMethods,
  type CreateClientOptions,
  type EffectCallOptions,
  type EffectClient,
  type EffectProcedure,
  type inferClientError,
  type inferClientInput,
  type inferEffectClientError,
  type MiddlewareOption,
  type ProcedureCallOptions,
  type PromiseProcedure,
  type ReservedClientKey,
} from './Client.js';
export {
  RpcDefect,
  RpcInterrupted,
  RpcTransportError,
  isClientInfrastructureError,
  type ClientError,
} from '@effect-trpc/core';
