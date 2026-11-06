# In-process caller

`createCaller(router, { handlers })` calls procedures in the same process, with no HTTP and no
serialization. Middleware still runs, and headers you pass reach it. Use it for server-side code
that needs a procedure (cron jobs, scripts, RSC), and for tests.

```ts
import { createCaller } from '@effect-trpc/server';

const caller = createCaller(appRouter, { handlers: ServerLive });
```

| Call                                                      | Returns                                                   |
| --------------------------------------------------------- | --------------------------------------------------------- |
| `caller.post.byId(input, { headers? })`                   | `Effect<Post, PostNotFound>`, no requirements             |
| `caller.post.onCreated(input)`                            | `Stream<Post, E>`                                         |
| `caller.$promise.post.byId(input, { signal?, headers? })` | `Promise<Post>`, rejects with `ClientError<PostNotFound>` |
| `caller.$promise.post.onCreated(input, { signal? })`      | `AsyncIterable<Post>`                                     |
| `caller.$router`                                          | the router                                                |
| `caller.dispose()`                                        | interrupts in-flight calls and releases the layer         |

## Example

<<< @/snippets/server/middleware.ts#call

## Caller or `localLink`?

Both run the handlers in-process. Pick by the API you want:

|                               | `createCaller`                             | `createClient(router, { link: localLink(...) })`     |
| ----------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| Promise API                   | `caller.$promise.x(...)`                   | `client.x(...)`                                      |
| Effect API                    | `caller.x(...)`: error channel exactly `E` | `client.$effect.x(...)`: `E \| RpcTransportError`    |
| Same code as a network client | no                                         | yes: swap the link                                   |
| Typical use                   | server code, RSC, tests of handlers        | tests of client code, SSR with the real client shape |

::: warning Gotchas

- The root keys `$promise`, `$router` and `dispose` are reserved: `createCaller` throws if the
  router has one of them at the top level.
- `handlers` must provide every middleware implementation, and the client half of
  `requiredForClient` middleware. A missing one is a compile error.
- After `dispose()`, calls fail with `RpcInterrupted`. Calling a path that is not a procedure throws.
- Aborting `signal` interrupts the handler and rejects with `RpcInterrupted`. Defects reject with
  `RpcDefect`.

:::

See also: [`createCaller`](/api/server#createcaller), [testing with the caller](../testing/caller).
