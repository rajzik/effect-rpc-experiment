# Live data over WebSocket

Over HTTP, each subscription holds one request open. For live dashboards, chats and feeds, serve a
WebSocket endpoint and use `wsLink`: every query, mutation and subscription shares one connection.

## Server

<<< @/snippets/advanced/live-data.tsx#server

Keep the HTTP endpoint too: it serves clients that do not need live data, and server-side code.

## Client

<<< @/snippets/advanced/live-data.tsx#client

`retryTransientErrors: true` reconnects after transient socket errors instead of failing in-flight
calls.

## Component

<<< @/snippets/advanced/live-data.tsx#component

`onConnectionStateChange` reports `idle`, `connecting` and `pending` (live), so the UI can show the
state. Failures arrive through `onError` and `sub.status === 'error'`. Writing elements into the query cache keeps the rest of the UI (detail views, lists) in sync
with the stream.

## Server-side fan-out

The handler is an Effect `Stream`, so fan-out is a `PubSub`: mutations publish, subscriptions read.
See the chat example in [streams and subscriptions](../server/streams).

::: warning Gotchas

- A subscription that ends with an error stays in `error` until `reset()` or a remount: there is no
  automatic resubscription.
- Per-call `headers` are sent with each rpc message. Connection-level auth (cookies) is checked once,
  when the socket opens.
- Serverless platforms usually cannot hold WebSockets. Run the WebSocket endpoint on a long-lived
  server.

:::
