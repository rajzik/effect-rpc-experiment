# Differences from tRPC

The API follows `@trpc/tanstack-react-query`, so most code ports by renaming. These are the
differences.

| `@trpc/tanstack-react-query`               | `@rpc-effect/tanstack-react-query`                              |
| ------------------------------------------ | --------------------------------------------------------------- |
| `createTRPCContext()`                      | `createRpcContext()`                                            |
| `TRPCProvider`, `useTRPC`, `useTRPCClient` | `RpcProvider`, `useRpc`, `useRpcClient`                         |
| `<TRPCProvider trpcClient={…}>`            | `<RpcProvider client={…}>`                                      |
| `createTRPCOptionsProxy({ router, ctx })`  | `createRpcOptionsProxy({ client })` with a `localLink` client   |
| `opts.trpc.path`, `trpc: { context }`      | `opts.rpc.path`, `rpc: { headers }`                             |
| `TRPCClientError` with an error shape      | `ClientError<E>`: your classes plus three infrastructure errors |
| infinite input gets `direction`            | no `direction` field                                            |
| subscriptions reconnect, `tracked()`       | no reconnection, no `tracked()` / `lastEventId`                 |
| streamed (async iterable) query results    | not supported: use a subscription                               |

## Behavior

- **Abort signals** are always passed. Unmounting the last observer of a running query cancels it,
  and the server handler is interrupted.
- **Subscription states.** A subscription is `pending` once its request is handed to the transport.
  Links don't reconnect, so there is no `connecting` state after an error.
- **Errors** have no formatter. The server decides the error type with schemas, and the client gets
  instances of those classes.
- **Hydration** is Schema-aware: use `createHydrationHelpers` instead of TanStack's
  `dehydrate`/`hydrate`, or class instances are lost.

See also: [Migrating from tRPC](../advanced/migrating-from-trpc).
