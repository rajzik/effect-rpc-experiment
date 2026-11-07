# @effect-trpc/client

Typed clients for [`@effect-trpc/core`](../core) routers: a tRPC-style **Promise client**
(`client.post.byId(input)`), an **Effect client** (`client.$effect.post.byId(input)`), and
subscriptions as `AsyncIterable` / `Stream`. Each call goes through a **link** (`httpLink`,
`httpBatchLink`, `wsLink` or `localLink`) built on `effect/rpc`.

- Results are decoded with the procedure's schemas. A `Schema.Class` arrives as a real instance
  with working methods, and `Date` fields arrive as `Date`.
- Failures are the procedure's own `Schema.TaggedError` instances. Defects, transport failures
  and aborts are separate typed errors (`RpcDefect`, `RpcTransportError`, `RpcInterrupted`), so
  they never show up looking like your domain errors.
- Aborting a call interrupts the handler on the server.
- `createClient` takes a `Router.make` router or a router written as an Effect service
  (`createClient(AppRouter, { link })`); annotate a service client as
  `Client<Router.Of<typeof AppRouter>>`.

## For AI agents

**Use this package when**

- code in a browser, another server or a script calls an `@effect-trpc/core` router served by
  `@effect-trpc/server` (`httpLink`, `wsLink`, or `httpBatchLink` to send the queries of one tick
  in one POST);
- tests or SSR should exercise the client API against in-process handlers (`localLink`);
- you need a custom transport over any `effect/rpc` `RpcClient.Protocol` (`Link.fromProtocol`).

Use a sibling instead to define routers (`@effect-trpc/core`), to implement / serve them or call
them in-process without the client API (`@effect-trpc/server`, `createCaller`), or for React
Query (`@effect-trpc/tanstack-react-query`, which wraps this client).

**Entry points**

| import path           | exports                                                                                                                                                                                                                                                                                                                                                               | source                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `@effect-trpc/client` | `createClient`, `httpLink`, `httpBatchLink`, `wsLink`, `localLink`, `Link` (`make`, `fromProtocol`); types `Client`, `ClientMethods`, `CreateClientOptions`, `ProcedureCallOptions`, `EffectCallOptions`, `HttpLinkOptions`, `HttpBatchLinkOptions`, ...; re-exports `RpcDefect`, `RpcTransportError`, `RpcInterrupted`, `ClientError`, `isClientInfrastructureError` | `src/index.ts` → `src/Client.ts`, `src/Link.ts` (errors: `@effect-trpc/core`) |

**Golden path**

```ts
import { Effect, Schema } from 'effect';
import { query, Router } from '@effect-trpc/core';
import { createClient, httpLink, type Client } from '@effect-trpc/client';

class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.Number,
}) {}

// 1. The same router value the server implements (import it from a shared module).
const appRouter = Router.make({
  post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
});

// 2. A client over an ABSOLUTE url, served by @effect-trpc/server (HTTP + NDJSON).
const client = createClient(appRouter, { link: httpLink({ url: 'http://localhost:3000/rpc' }) });

// 3a. Promise API: rejects with ClientError<PostNotFound>.
try {
  const post = await client.post.byId({ id: 1 }); // Post instance
} catch (cause) {
  const error = cause as Client.Error<typeof appRouter.record.post.byId>;
  if (error._tag !== 'PostNotFound') throw error; // RpcDefect | RpcTransportError | RpcInterrupted
}

// 3b. Effect API: Effect<string, RpcTransportError>, no requirements.
const title = client.$effect.post.byId({ id: 1 }).pipe(
  Effect.map((post) => post.title),
  Effect.catchTag('PostNotFound', () => Effect.succeed('missing')),
);

// 4. Release connections.
await client.dispose();
```

See [Links](#links) for `wsLink` / `localLink` and [Effect client](#effect-client) for streams.

**Invariants**

- Typed errors are the procedure's `Schema.TaggedError` instances, discriminated by `_tag`.
- Promise rejections are `ClientError<E> = E | RpcDefect | RpcTransportError | RpcInterrupted`; `$effect` calls fail with `E | RpcTransportError` (defects are defects, cancellation is interruption).
- `httpLink` / `httpBatchLink` need an absolute `http(s):` URL and `wsLink` an absolute `ws(s):` URL; anything else throws when the link is created.
- `httpBatchLink({ ...httpLink options, maxItems? })` sends the queries called in the same tick (within 1 ms of the first) in one POST (`effect/rpc`'s batching HTTP protocol), split into POSTs of at most `maxItems` (a positive integer; default unlimited, otherwise the link throws when created). Mutations and subscriptions are never batched: one POST each, like `httpLink`. The server needs no option: every `@effect-trpc/server` HTTP adapter already accepts several requests in one body and streams the responses back by request id (NDJSON: each call settles as soon as its own result arrives).
- Batched calls keep their own typed errors, decoding and middleware. A `headers` function runs once per POST. A non-2xx response or network error fails every call of the POST with `RpcTransportError`; a typed failure or defect fails only its call.
- Aborting one call of a batch rejects it at once with `RpcInterrupted` and the POST goes on for the others. A batch POST is never aborted for its callers, not even when all of them abort: the server runs aborted queries to the end, and `client.dispose()` aborts the POSTs still open.
- The calls of a batch share one HTTP response: headers and cookies a handler sets (`HttpContext`) apply to all of them, and (framed) only if set before the first response chunk. With `serialization: 'json'` a batch waits for its slowest call.
- Link and server must agree on protocol (`httpLink` ↔ `protocol: "http"`, `wsLink` ↔ `protocol: "websocket"`) and serialization (link default `"ndjson"`).
- A router may not use `$effect`, `$router`, `dispose` or `withHeaders` as top-level keys (`createClient` throws).
- Routers with `requiredForClient` middleware require the `middleware` option (`RpcMiddleware.layerClient(...)`); it is a type error to omit it.
- The link connects lazily on the first call; after `dispose()` calls fail with `RpcTransportError`.
- `createClient(router, ...)` takes a `Router.Input` (router or router service class, normalised with `Router.from`); a service client is `Client<Router.Of<typeof AppRouter>>` and has the same call types as the equivalent `Router.make` router. `$router` is the normalised router.

**Common mistakes**

- Don't pass a relative URL (`'/rpc'`) to `httpLink` → `new URL('/rpc', location.origin).href`.
- Don't use `httpBatchLink` for calls that set cookies or headers → a batch shares one response, and only queries are batched: set them from a mutation (never batched) or use `httpLink`.
- Don't use `serialization: 'json'` with `httpBatchLink` → the server answers when every call of the POST has finished; keep the default `"ndjson"`.
- Don't point `wsLink` at a `toWebHandler` endpoint → serve `layerHttp(router, { protocol: 'websocket' })` and match `serialization` (both default to `"ndjson"`; override on both sides or neither).
- Don't treat every rejection as a domain error → switch on `error._tag`; infrastructure tags start with `@effect-trpc/`.
- Don't expect `RpcDefect` / `RpcInterrupted` in the `$effect` error channel → inspect the `Cause` (`Effect.exit`, `Effect.catchCause`).
- Don't give `localLink` a handler layer without the middleware implementations → `Layer.mergeAll(handlers, AuthLive)` (missing ones are a type error).
- Don't create a client per call → create one per app (or per request on the server) and `dispose()` it.
- Don't mutate headers on the client → `client.withHeaders({...})` returns a client sharing the connection.
- Don't use Effect v3 imports (`@effect/rpc`, `@effect/platform`) → `effect/rpc`, `effect/http`.
- Don't write `Client<typeof AppRouter>` for a router service (a type error) → `Client<Router.Of<typeof AppRouter>>`; `createClient` itself takes the class.
- Don't write `ReturnType<typeof createClient>` (uninstantiated: TS2589 "excessively deep", because `createClient` is overloaded for router services) → `Client<R>` / `CreateClientOptions<R>`, or the instantiated form `ReturnType<typeof createClient<typeof appRouter>>` (for a service: `createClient<Router.Of<typeof AppRouter>>`).

**Where to look**

- `test/readme.test.ts` (this README's examples), `test/httpLink.test.ts` (instances, typed errors, defects, streams, headers, non-2xx → `RpcTransportError`, absolute URLs), `test/wsLink.test.ts`, `test/batchLink.test.ts` (`httpBatchLink`: one POST per tick, `maxItems`, errors, abort), `test/localLink.test.ts` (Effect client, headers merge, proxy, lazy link, dispose), `test/abort.test.ts` (abort, interruption, subscription cleanup), `test/middleware.test.ts` (`requiredForClient`), `test/routerService.test(-d).ts` (router service classes), `test/client.test-d.ts` (call, error and option types), `test/PARITY.md`.
- JSDoc on every export (`src/*.ts`) follows `docs/jsdoc-style.md`.

**Verify**

```sh
pnpm exec vp -C packages/client test
pnpm exec vp -C packages/client pack
node scripts/verify-jsdoc.mjs client
```

## Install

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
| `httpBatchLink({ url, …httpLink options, maxItems? })`               | queries of the same tick in one POST; mutations and subscriptions one POST each                 |
| `wsLink({ url, serialization?, retryTransientErrors?, WebSocket? })` | one multiplexed WebSocket (server: `protocol: 'websocket'`). Opened on first use                |
| `localLink({ handlers })`                                            | in-process, no serialization. For tests, SSR and scripts                                        |
| `Link.make(makeClient)` / `Link.fromProtocol(layer)`                 | custom transports (any `RpcClient.Protocol`)                                                    |

`serialization` is `'ndjson'` (default), `'json'`, or an `RpcSerialization` layer, and must match
the server.

`httpBatchLink` is `httpLink` with batching: queries called in the same tick share one POST (tRPC's
`httpBatchLink`), so queries fired together (e.g. several `useQuery` hooks mounting at once) cost one
request. `maxItems` caps the calls per POST.
Calls that set response headers or cookies belong on `httpLink`: a batch shares one response.

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

- `createClient(router, { link, headers?, middleware? })` returns `Client<R>` (for a router
  service class, `Client<Router.Of<typeof AppRouter>>`). A client has the
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
