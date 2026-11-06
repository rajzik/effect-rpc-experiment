# Type inference

You rarely write a type by hand: inputs, outputs and errors are inferred from the router. When you
need one (a form's state, a helper's parameter, a test), use these helpers.

## One procedure

<<< @/snippets/concepts/inference.ts#procedure

| Helper        | Gives                                                             |
| ------------- | ----------------------------------------------------------------- |
| `inferInput`  | the decoded payload type (`void` without a payload)               |
| `inferOutput` | the success type; for a subscription, the element type            |
| `inferError`  | the declared errors plus the errors of the procedure's middleware |
| `inferKind`   | `"query" \| "mutation" \| "subscription"`                         |

## A whole router

<<< @/snippets/concepts/inference.ts#router

`inferRouterInputs`, `inferRouterOutputs` and `inferRouterErrors` return maps nested like the
router (as in tRPC). `Router.Paths<R>` is the union of tags.

## Client-side types

<<< @/snippets/concepts/inference.ts#client

`Client.Error<Def>` is `ClientError<inferError<Def>>`, the rejection type of a Promise call.
TanStack Query has its own helpers on the options proxy: `inferProxyInput`, `inferProxyOutput` and
`inferProxyError` (see [the API](/api/tanstack-react-query#inferproxyerror)).

::: tip
Import router types with `import type` in client code. The router value is safe to import too (it
only holds schemas), and the client needs it at runtime.
:::

See also: [`inferRouterInputs`](/api/core#inferrouterinputs), [`Client`](/api/client#client).
