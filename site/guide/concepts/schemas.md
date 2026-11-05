# Schemas and serialization

Every value that crosses a boundary goes through the procedure's Effect Schemas: the payload on
the way in, the success value and the error on the way out. Nothing else needs configuring. There
is no transformer to register, and `Date`, `BigInt`, `Option` and classes all work.

## Declaring schemas

<<< @/snippets/concepts/schemas.ts#payloads

## Classes arrive as classes

<<< @/snippets/concepts/schemas.ts#roundtrip

A `Schema.Class` is encoded with its schema on the server and decoded with the same schema on the
client. The client sees a real instance, so getters, methods and `instanceof` work. Errors are
`Schema.TaggedError` classes and work the same way: `error instanceof PostNotFound` is true.

This holds over every link:

| Link                    | What happens                                                         |
| ----------------------- | -------------------------------------------------------------------- |
| `httpLink`, `wsLink`    | encoded by the server, decoded by the client (NDJSON or JSON)        |
| `localLink`, the caller | no serialization: the handler's instance is passed through           |
| SSR hydration           | `dehydrate` encodes with the procedure's codec, `hydrate` decodes    |
| Next.js server actions  | the action result is an encoded `Exit`, decoded by `useServerAction` |

## Codecs for your own boundaries

When a value leaves through a boundary effect-trpc does not own (a cache, a queue, a cookie),
encode it with the procedure's codec, or you get plain objects back.

<<< @/snippets/concepts/schemas.ts#codecs

| Codec                 | Schema                                                               |
| --------------------- | -------------------------------------------------------------------- |
| `Codecs.payload(rpc)` | the payload                                                          |
| `Codecs.success(rpc)` | the success value; for subscriptions, one element                    |
| `Codecs.error(rpc)`   | the error schema, plus the stream error and middleware error schemas |
| `Codecs.exit(rpc)`    | `Exit<Success, Error>` (`void` success for streams)                  |

Each comes with `encode…Sync` and `decode…Sync` helpers. The codecs are derived with
`Schema.toCodecJson` and memoized per rpc.

::: warning Gotchas

- `JSON.stringify` on a decoded value gives you the encoded shape only by accident. Always go
  through a codec when the value must come back as a class.
- The `…Sync` helpers throw a `SchemaError` on invalid input, and cannot run schemas that need
  services. Use `Schema.encodeEffect` / `Schema.decodeUnknownEffect` with the codec for those.
- A schema change is a wire-format change. Old clients that cannot decode a new response get an
  `RpcDefect`.

:::

See also: [`Codecs`](/api/core#codecs), [SSR hydration](../react-query/hydration),
[server actions](../frameworks/next#server-actions).
