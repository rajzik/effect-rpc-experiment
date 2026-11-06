# Quick start

One router, a Node server, a Promise client and a React component, end to end. Every later guide
builds on this router.

## 1. Declare the router

The router is shared by the server and the client: import it from both. It holds only schemas, so
it is safe to bundle for the browser.

<<< @/snippets/shared/router.ts [router.ts]

- `query`, `mutation` and `subscription` take a `payload` (struct fields or a schema), a `success`
  schema and an `error` schema. Leave `payload` out and the procedure takes no input.
- Errors are `Schema.TaggedError` classes. The client narrows them on `_tag`.
- `Auth` is an `effect/rpc` middleware. It adds `Unauthorized` to the errors of `post.create` and
  provides `CurrentUser` to its handler.

## 2. Implement it

`Handlers.make` takes a record that mirrors the router. Each handler returns an `Effect` (a
`Stream` for subscriptions) whose error must be one of the procedure's declared errors.

<<< @/snippets/shared/server.ts [server-impl.ts]

`ServerLive` is a `Layer`. Every adapter takes it as `handlers`: the Node server, the fetch
handler, the in-process caller, Next.js and TanStack Start.

## 3. Serve it

<<< @/snippets/quick-start/server.ts

`serve` returns a `Layer`. For tests and scripts, `runServer` returns a Promise instead. For
serverless and edge runtimes, `toWebHandler` gives you a `(Request) => Promise<Response>`. See
[Serving over HTTP](./server/serving).

## 4. Call it

<<< @/snippets/quick-start/client.ts#promise [client.ts]

The same call as an Effect: the error channel is exactly `PostNotFound | RpcTransportError`.

<<< @/snippets/quick-start/client.ts#effect [client.ts]

## 5. Use it in React

<<< @/snippets/quick-start/react.tsx [App.tsx]

`post.error` is typed as the procedure's errors plus the three infrastructure errors, so the
`_tag` check narrows it to a `PostNotFound` instance.

## Or write it as a service

The router above declares the schemas in one module and the handlers in another. The same router
can be written once, as an Effect service whose procedures carry their handlers. Server and client
import the one class, and there is no `Handlers.make` or `type AppRouter = typeof appRouter`.

<<< @/snippets/concepts/router-service-demo.ts#router [router.ts]

`Handlers.fromService(AppRouter)` builds the layer from the procedures, and every adapter takes the
class where it takes a router:

<<< @/snippets/concepts/router-service-demo.ts#serve

The client is `createClient(AppRouter, …)`, with the same types and the same decoded `Post`
instances. See [Routers as services](./concepts/router-services) for the rules (`make` must not
read services), nesting, middleware and the React helper types.

## Where next

- How the errors are modeled, and when to use which: [the error model](./concepts/errors).
- Server middleware, auth context and services: [middleware](./server/middleware).
- Next.js App Router with RSC prefetching: [Next.js](./frameworks/next).
