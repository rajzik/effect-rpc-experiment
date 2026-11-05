# Defects vs domain errors

effect-trpc follows Effect's split between expected failures and defects:

|          | Domain error (`E`)                                                  | Defect                                       |
| -------- | ------------------------------------------------------------------- | -------------------------------------------- |
| What     | a failure the caller can act on: not found, forbidden, rate limited | a bug or an unexpected condition             |
| Declared | in the procedure's `error` schema                                   | nowhere                                      |
| Server   | `Effect.fail(new PostNotFound(...))`                                | a throw, `Effect.die`, an undeclared failure |
| Client   | an instance of your class                                           | `RpcDefect` with the message only            |
| Retry    | no                                                                  | no                                           |

## Decide per failure

<<< @/snippets/advanced/defects.ts#handlers

Map the failures clients should handle to declared errors. Let everything else become a defect, and
log it with its cause on the server, where the details belong.

<<< @/snippets/advanced/defects.ts#client

## Why servers disable fatal defects

`effect/rpc` treats a defect as fatal to the connection by default. effect-trpc's adapters always set
`disableFatalDefects: true`, so a defect fails only its own call, and every other call on the same
connection or socket keeps working. If you wire `RpcServer` yourself, set it too.

## What the client learns

- `RpcDefect.message` is the defect's message (`defect.message`, or `String(defect)`).
- The `cause` is kept for in-process calls and dropped where it would leave the server: SSR
  hydration and server actions keep the message only.
- A response the client cannot decode (schema drift between server and client) is also an
  `RpcDefect`.

::: tip
Treat a spike of `RpcDefect`s as an incident. Treat a spike of domain errors as product behavior.
:::

See also: [the error model](../concepts/errors).
