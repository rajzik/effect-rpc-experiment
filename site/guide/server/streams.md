# Streams and subscriptions

A `subscription` procedure streams values. Its handler returns an Effect `Stream`. Clients get an
`AsyncIterable` (Promise API), a `Stream` (Effect API) or a subscription hook (React). Over HTTP the
stream is NDJSON on one response. Over a WebSocket it is multiplexed with every other call.

## Define

<<< @/snippets/server/streams.ts#define

`success` is the schema of one element. `error` is the schema the stream may fail with.

## Implement

<<< @/snippets/server/streams.ts#handlers

Any `Stream` works: from a schedule, a `PubSub`, a `Queue`, a database change feed, another
subscription. Failing the stream with a declared error ends it, and the client receives that error.

## Consume

<<< @/snippets/server/streams.ts#consume

| Client                 | Gets                   | Stop it with                   |
| ---------------------- | ---------------------- | ------------------------------ |
| Promise client, caller | `AsyncIterable<A>`     | `break`, `signal`, `dispose()` |
| Effect client, caller  | `Stream<A, E>`         | `Stream.take`, interruption    |
| TanStack Query         | `useSubscription(...)` | unmount, `enabled: false`      |

Stopping on the client interrupts the server stream: finalizers run, `PubSub` subscriptions are
released.

::: warning Gotchas

- Keep `serialization: "ndjson"` (the default) for subscriptions over HTTP, or elements are
  buffered until the stream ends.
- A subscription over HTTP holds one request open. Platforms with response timeouts (serverless
  functions) end it: use a WebSocket server, or reconnect on the client.
- Errors in the middle of a stream end the stream. To keep going after a recoverable error, catch it
  in the handler and emit a value instead.

:::

See also: [subscriptions in React](../react-query/subscriptions),
[live data over WebSocket](../advanced/live-data).
