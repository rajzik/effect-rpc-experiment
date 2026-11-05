# The error model

A call can fail for two kinds of reasons: the handler failed with an error you declared, or the
infrastructure failed. effect-trpc keeps them apart. A client call for a procedure with error type
`E` fails with exactly:

```ts
type ClientError<E> = E | RpcDefect | RpcTransportError | RpcInterrupted;
```

| Error               | `_tag`                           | When                                                                       | Retry? |
| ------------------- | -------------------------------- | -------------------------------------------------------------------------- | ------ |
| `E`                 | your tags                        | the handler failed with a declared error; you get the same class back      | no     |
| `RpcDefect`         | `@effect-trpc/RpcDefect`         | the handler died or threw, or the response could not be decoded            | no     |
| `RpcTransportError` | `@effect-trpc/RpcTransportError` | network, HTTP status or protocol failure (`cause` is the `RpcClientError`) | yes    |
| `RpcInterrupted`    | `@effect-trpc/RpcInterrupted`    | the call was aborted or interrupted                                        | no     |

Domain errors are never disguised as infrastructure errors, and infrastructure errors are never
disguised as yours. The three infrastructure errors are `Schema.TaggedError`s too, so they can be
serialized (SSR, server actions) and narrowed on `_tag` like your own.

## With the Promise client

<<< @/snippets/concepts/errors.ts#promise

The `switch` is exhaustive: TypeScript knows all four cases. `isClientInfrastructureError` tells
the three infrastructure errors apart from yours:

<<< @/snippets/concepts/errors.ts#guard

## With the Effect client

<<< @/snippets/concepts/errors.ts#effect

The Effect API is shaped the Effect way:

| Promise client rejects with | Effect client                              |
| --------------------------- | ------------------------------------------ |
| `E`                         | typed failure `E`                          |
| `RpcTransportError`         | typed failure `RpcTransportError`          |
| `RpcDefect`                 | a defect (`Effect.die`): use `catchDefect` |
| `RpcInterrupted`            | interruption                               |

The in-process caller's Effect API (`caller.post.byId(...)`) has no transport, so its error
channel is exactly `E`.

## In TanStack Query

`useQuery(rpc.post.byId.queryOptions(...)).error` is `ClientError<PostNotFound> | null`, so the same
`_tag` narrowing works in components. A good `retry` policy retries transport errors only:

```ts
retry: (count, error) => error instanceof RpcTransportError && count < 3;
```

## Mapping a `Cause` yourself

When you build on `effect/rpc` directly (custom adapters, tests with `RpcTest`), map an `Exit` or a
`Cause` to the same model:

<<< @/snippets/concepts/errors.ts#cause

`isRpcClientError(e)` tells `effect/rpc`'s transport errors apart from the procedure's errors.
`causeToClientError` maps `Fail(e)` to `e` (or to `RpcTransportError` when `e` is an
`RpcClientError`), `Die` to `RpcDefect` and interruption to `RpcInterrupted`. A typed failure wins
over a defect, and a defect over interruption. `exitToClientError(exit)` returns
`Option<ClientError<E>>`.

::: warning Gotchas

- Narrow on `_tag`, not `instanceof`, when the value may have crossed a JSON boundary you did not
  decode with a codec. Through effect-trpc's own boundaries (links, hydration, server actions) both
  work.
- A handler that throws, or fails with an error that is not in its schema, is a defect:
  `RpcDefect` on the client. Declare the errors clients should handle.
- Servers must run with `disableFatalDefects: true` (the effect-trpc adapters set it). Otherwise
  one defect closes the connection and every in-flight call fails.

:::

See also: [`ClientError`](/api/core#clienterror), [`RpcDefect`](/api/core#rpcdefect),
[`causeToClientError`](/api/core#causetoclienterror),
[Defects vs domain errors](../advanced/defects).
