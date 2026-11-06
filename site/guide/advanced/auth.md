# Authentication

A complete setup: the client sends a bearer token, a middleware turns it into a typed `User`
service, a second middleware enforces a role, and both failures reach the client as typed errors.

## Shared: errors, services and middleware declarations

<<< @/snippets/advanced/auth.ts#shared

- `Authenticate` **provides** `CurrentUser` and can fail with `Unauthenticated`.
- `RequireAdmin` **requires** `CurrentUser` and can fail with `Forbidden`.
- Middleware added later runs first, so on `admin` the order is `.middleware(RequireAdmin)` then
  `.middleware(Authenticate)`: authentication runs before the role check.

## Server: implementations

<<< @/snippets/advanced/auth.ts#server

The token check depends on a `Tokens` service, provided once with the rest of the server layer.
Handlers read `CurrentUser` with `yield*`: no context object, and the types prove it is provided.

## Client: headers and typed failures

<<< @/snippets/advanced/auth.ts#client

The headers function runs once per call, so a refreshed token is picked up without recreating the
client.

## Variations

| Need                             | How                                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| cookies instead of bearer tokens | read `headers['cookie']` in the middleware; same-origin `httpLink` sends cookies                      |
| Next.js RSC and server actions   | forward `headers()` from `next/headers` (see [Next.js](../frameworks/next#rsc))                       |
| per-tenant data                  | a `Tenant` middleware that provides a `Tenant` service from a header or the user                      |
| sign every request               | client middleware with `requiredForClient` ([client middleware](../client/middleware))                |
| Electron                         | `MainRpcServer.senderId(headers)` identifies the window ([Electron](../frameworks/electron#security)) |

::: warning Gotchas

- Declare middleware in the shared router module, implement it on the server. The client needs the
  declaration for the error types.
- `requires` is checked by the types: attaching `RequireAdmin` without `Authenticate` outside it
  leaves `CurrentUser` unprovided, and the server layer does not compile.
- Return typed errors from middleware (`Effect.fail(new Unauthenticated())`), never throw: a thrown
  error is a defect.

:::
