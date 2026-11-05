# Cancellation and timeouts

Cancelling a call in effect-trpc cancels the work on the server: the handler's fiber is interrupted
and its finalizers run. This holds over every link.

## Promise API: `AbortSignal`

<<< @/snippets/advanced/cancellation.ts#promise

## Effect API: interruption

<<< @/snippets/advanced/cancellation.ts#effect

## Who cancels what

| Trigger                                       | Client sees                         | Server                         |
| --------------------------------------------- | ----------------------------------- | ------------------------------ |
| `signal` aborted                              | `RpcInterrupted`                    | handler interrupted            |
| Effect interrupted (`timeout`, `race`, fiber) | interruption                        | handler interrupted            |
| `break` out of a subscription loop            | iteration ends                      | stream interrupted             |
| last TanStack observer unmounts               | query cancelled                     | handler interrupted            |
| `useSubscription` restart or unmount          | —                                   | stream interrupted             |
| `client.dispose()`                            | in-flight: `RpcInterrupted`         | handlers interrupted           |
| server `dispose()`                            | `RpcTransportError` or interruption | in-flight requests interrupted |

## Making handlers cancellation-friendly

Interruption stops an Effect at its next yield point. Use Effect APIs that support interruption
(`Effect.tryPromise` with the `signal` it gives you, `Effect.acquireRelease` for resources), and
clean-up runs when a client gives up.

```ts
byId: ({ id }) =>
  Effect.tryPromise({
    try: (signal) => db.query('select * from posts where id = $1', [id], { signal }),
    catch: () => new PostNotFound({ id }),
  }),
```

::: warning Gotchas

- `Effect.timeout` fails with a `TimeoutError` in the typed channel, which is not a `ClientError`:
  handle it where you add the timeout.
- Mutations can be interrupted half-way like anything else. Make them idempotent, or run the
  critical part with `Effect.uninterruptible` on the server.

:::
