# @effect-trpc/client

Typed clients for [`@effect-trpc/core`](../core) routers: a tRPC-style **Promise client**
(`client.post.byId(input)`), an **Effect client** (`client.$effect.post.byId(input)`), and
subscriptions as `AsyncIterable` / `Stream`. Each call goes through a **link** (`httpLink`,
`wsLink` or `localLink`) built on `effect/rpc`.

- Results are decoded with the procedure's schemas. A `Schema.Class` arrives as a real instance
  with working methods, and `Date` fields arrive as `Date`.
- Failures are the procedure's own `Schema.TaggedError` instances. Defects, transport failures
  and aborts are separate typed errors (`RpcDefect`, `RpcTransportError`, `RpcInterrupted`), so
  they never show up looking like your domain errors.
- Aborting a call interrupts the handler on the server.

```sh
pnpm add @effect-trpc/client @effect-trpc/core effect
```

## Define a router (shared by server and client)

```ts
import { mutation, query, Router, subscription } from '@effect-trpc/core';
import { Schema } from 'effect';

export class Post extends Schema.Class<Post>('Post')({
  id: Schema.Number,
  title: Schema.String,
  createdAt: Schema.Date,
}) {
  get slug(): string {
    return this.title.toLowerCase().replaceAll(' ', '-');
  }
}

export class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.Number,
}) {}

export const appRouter = Router.make({
  post: {
    byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }),
    create: mutation({ payload: { title: Schema.String }, success: Post }),
  },
  countdown: subscription({ payload: { from: Schema.Number }, success: Schema.Number }),
});
```

Serve it with `@effect-trpc/server`, or directly with
`RpcServer.layerHttp({ group: appRouter.group, path: '/rpc', protocol: 'http', disableFatalDefects: true })`.

## Promise client over HTTP

```ts
import { createClient, httpLink, type Client } from '@effect-trpc/client';

const client = createClient(appRouter, {
  link: httpLink({
    url: 'http://localhost:3000/rpc', // must be absolute
    headers: async () => ({ authorization: `Bearer ${await getToken()}` }), // evaluated per request
  }),
});

const post = await client.post.byId({ id: 1 });
post instanceof Post; // true
post.slug; // methods work
post.createdAt.getFullYear(); // a real Date

// Typed errors: the rejection is `ClientError<PostNotFound>`.
try {
  await client.post.byId({ id: 404 });
} catch (cause) {
  const error = cause as Client.Error<typeof appRouter.record.post.byId>;
  switch (error._tag) {
    case 'PostNotFound':
      console.log('no post', error.id); // `error` is a PostNotFound instance
      break;
    case '@effect-trpc/RpcInterrupted': // aborted
    case '@effect-trpc/RpcTransportError': // network, HTTP status, protocol
    case '@effect-trpc/RpcDefect': // the handler died
      throw error;
  }
}

// Subscriptions are async iterables (NDJSON streaming over plain HTTP).
for await (const n of client.countdown({ from: 3 })) console.log(n); // 3, 2, 1, 0

// Abort and per-call headers.
const controller = new AbortController();
const pending = client.post.byId(
  { id: 1 },
  { signal: controller.signal, headers: { 'x-trace': 'abc' } },
);
controller.abort(); // rejects with RpcInterrupted; the server handler is interrupted

await client.dispose(); // closes connections; later calls fail with RpcTransportError
```

Procedures that take no input can be called with no arguments: `client.health()`.

Use `client.withHeaders({ 'x-tenant': 'acme' })` to get a client that shares the same connection
and sends extra headers. Headers set on `createClient`, on `withHeaders` and on a single call are
merged, and the most specific value wins. They reach server handlers and middleware over every
link.

## Effect client

`client.$effect` mirrors the router. Each call returns an `Effect` with **no requirements**.
Its error channel is exactly the procedure's errors plus `RpcTransportError`. Defects stay
defects and cancellation is plain interruption. Subscriptions return a `Stream`.

```ts
import { Effect, Stream } from 'effect';

const title = client.$effect.post.byId({ id: 1 }).pipe(
  Effect.map((post) => post.title),
  Effect.catchTag('PostNotFound', (e) => Effect.succeed(`missing #${e.id}`)),
); // Effect<string, RpcTransportError>

const ticks = Stream.runCollect(client.$effect.countdown({ from: 2 })); // [2, 1, 0]
```

## Links

| link                                                                 | use                                                                                             |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `httpLink({ url, headers?, fetch?, serialization? })`                | one POST per call. Streams are NDJSON. `fetch` lets you plug in a custom fetch or a web handler |
| `wsLink({ url, serialization?, retryTransientErrors?, WebSocket? })` | one multiplexed WebSocket (server: `protocol: 'websocket'`). Opened on first use                |
| `localLink({ handlers })`                                            | in-process, no serialization. For tests, SSR and scripts                                        |
| `Link.make(makeClient)` / `Link.fromProtocol(layer)`                 | custom transports (any `RpcClient.Protocol`)                                                    |

`serialization` is `'ndjson'` (default), `'json'`, or an `RpcSerialization` layer, and must match
the server.

```ts
import { createClient, localLink, wsLink } from '@effect-trpc/client';
import { Effect, Layer, Stream } from 'effect';

// Tests and SSR: run the handlers in-process. The type checks that every procedure has a handler.
const handlers = appRouter.group.toLayer({
  'post.byId': ({ id }) => Effect.fail(new PostNotFound({ id })),
  'post.create': ({ title }) => Effect.succeed(new Post({ id: 1, title, createdAt: new Date() })),
  countdown: ({ from }) => Stream.range(0, from).pipe(Stream.map((i) => from - i)),
});
const local = createClient(appRouter, { link: localLink({ handlers }) });

// Real-time: one WebSocket for every call and subscription.
const live = createClient(appRouter, { link: wsLink({ url: 'ws://localhost:3000/rpc' }) });
```

If a router uses middleware declared with `requiredForClient: true`, `createClient` requires a
`middleware` option, which is the layer built with `RpcMiddleware.layerClient(...)`.

## API

- `createClient(router, { link, headers?, middleware? })` returns `Client<R>`. A client has the
  procedures plus `$effect`, `$router`, `withHeaders(headers)`, `dispose()` and
  `[Symbol.asyncDispose]`. A router may not use these names as top-level keys. The client
  connects lazily on the first call. Calling an unknown path throws an `Error`.
- Types:
  - `Client<R>`, `Client.Effect<R>`, `Client.Procedure<Def>`, `EffectProcedure<Def>`
  - `Client.Error<Def>`, which is `ClientError<E>`
  - `Client.Input<Def>`, `Client.Output<Def>`
  - `ProcedureCallOptions` (`{ signal?, headers? }`), `EffectCallOptions` (`{ headers? }`)
- Re-exported from core: `RpcDefect`, `RpcTransportError`, `RpcInterrupted`, `ClientError`,
  `isClientInfrastructureError`.
