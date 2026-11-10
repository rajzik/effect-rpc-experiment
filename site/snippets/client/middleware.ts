import { Effect, Layer, Schema } from 'effect';
import { Headers } from 'effect/http';
import { RpcMiddleware } from 'effect/rpc';
import { query, Router } from '@rpc-effect/core';
import { createClient, httpLink } from '@rpc-effect/client';

// #region declare
class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}

// `requiredForClient: true`: every client of this router must provide the client half.
class Signed extends RpcMiddleware.Service<Signed>()('Signed', {
  error: Unauthorized,
  requiredForClient: true,
}) {}

export const router = Router.make({
  secret: query({ success: Schema.String }).middleware(Signed),
});
// #endregion declare

// #region client
declare const sign: (body: unknown) => string;

// The client half runs before the transport: it can rewrite the request.
const SignedClient = RpcMiddleware.layerClient(Signed, ({ request, next }) =>
  next({
    ...request,
    headers: Headers.set(request.headers, 'x-signature', sign(request.payload)),
  }),
);

const client = createClient(router, {
  link: httpLink({ url: 'https://api.example.com/rpc' }),
  middleware: SignedClient, // a compile error to leave it out
});
// #endregion client

// #region server
// The server half checks the header.
export const SignedServer = Layer.succeed(Signed)((effect, { headers }) =>
  headers['x-signature'] === undefined ? Effect.fail(new Unauthorized()) : effect,
);
// #endregion server

void client;
