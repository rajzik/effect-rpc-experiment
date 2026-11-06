# Subscriptions

`useSubscription(rpc.<path>.subscriptionOptions(input, callbacks))` runs a subscription procedure
while the component is mounted.

<<< @/snippets/react-query/subscriptions.tsx#hook

## States

| `status`     | Meaning                                                          | `data`             | `error`          |
| ------------ | ---------------------------------------------------------------- | ------------------ | ---------------- |
| `idle`       | not running: `skipToken` input or `enabled: false`               | `undefined`        | `null`           |
| `connecting` | starting; the request has not been handed to the transport yet   | last value, if any | `null`           |
| `pending`    | running, and still after the stream completes (see `onComplete`) | the last element   | `null`           |
| `error`      | the stream failed                                                | last value, if any | `ClientError<E>` |

`sub.reset()` starts it again (after an error, for example).

## Lifecycle

- It restarts when the input changes, when `enabled` flips and when the client changes (a new
  `client` on `RpcProvider`).
- It is aborted on restart and on unmount, which interrupts the server stream.
- No callback runs after it was stopped.
- If `onData` or `onStarted` throws, the subscription stops, the server stream is closed and
  `onError` receives the error.

## Callbacks

| Callback                  | Called with                                    |
| ------------------------- | ---------------------------------------------- |
| `onStarted`               | —, once the request is handed to the transport |
| `onData`                  | each element (decoded)                         |
| `onError`                 | `ClientError<E>`                               |
| `onComplete`              | —, when the server ends the stream             |
| `onConnectionStateChange` | `{ state, error }`                             |

## Outside React

<<< @/snippets/react-query/subscriptions.tsx#imperative

::: warning Gotchas

- Links don't reconnect. After a transport error the subscription is in `error`. Call `reset()`, or
  remount, to start again. `tracked()` and `lastEventId` from tRPC are not supported.
- Over HTTP each subscription holds one request open. With many subscriptions, use
  [`wsLink`](../client/links#websocket) to share one connection.
- `data` is the last element only. To accumulate, write into the query cache (as above) or into
  state from `onData`.

:::

See also: [`useSubscription`](/api/tanstack-react-query#usesubscription),
[streams on the server](../server/streams), [live data recipe](../advanced/live-data).
