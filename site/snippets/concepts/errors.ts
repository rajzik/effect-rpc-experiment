import { Effect, Exit, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';
import {
  causeToClientError,
  isClientInfrastructureError,
  type ClientError,
} from '@effect-trpc/core';
import { createClient, localLink } from '@effect-trpc/client';

import { appRouter, type PostNotFound } from '@/router';
import { AuthLive, HandlersLive, ServerLive } from '@/server';

const client = createClient(appRouter, { link: localLink({ handlers: ServerLive }) });

// #region promise
// A Promise call rejects with ClientError<E> = E | RpcDefect | RpcTransportError | RpcInterrupted.
const describe = (error: ClientError<PostNotFound>): string => {
  switch (error._tag) {
    case 'PostNotFound':
      return `no post #${error.id}`; // your error, as a PostNotFound instance
    case '@effect-trpc/RpcTransportError':
      return 'network, HTTP status or protocol failure: retry may help';
    case '@effect-trpc/RpcDefect':
      return `the handler died: ${error.message}`;
    case '@effect-trpc/RpcInterrupted':
      return 'aborted';
  }
};

try {
  await client.post.byId({ id: 404 });
} catch (cause) {
  console.log(describe(cause as ClientError<PostNotFound>));
}
// #endregion promise

// #region guard
const retryable = (error: unknown): boolean =>
  isClientInfrastructureError(error) && error._tag === '@effect-trpc/RpcTransportError';
// #endregion guard

// #region effect
// The Effect API keeps the typed channel exact: E | RpcTransportError. Defects stay defects and
// cancellation is interruption, as in any other Effect.
const title = client.$effect.post.byId({ id: 404 }).pipe(
  Effect.map((post) => post.title),
  Effect.catchTag('PostNotFound', () => Effect.succeed('untitled')),
); // Effect<string, RpcTransportError>
// #endregion effect

// #region cause
// Building your own adapter on effect/rpc: map any Cause to the same ClientError model.
const program = Effect.gen(function* () {
  const raw = yield* RpcTest.makeClient(appRouter.group); // in-memory effect/rpc client
  const exit = yield* Effect.exit(raw['post.byId']({ id: 7 }));
  if (Exit.isSuccess(exit)) return exit.value.title;
  const error = causeToClientError(exit.cause); // ClientError<PostNotFound>
  return isClientInfrastructureError(error) ? `infrastructure: ${error._tag}` : error._tag;
});

await Effect.runPromise(
  program.pipe(Effect.scoped, Effect.provide(Layer.merge(HandlersLive, AuthLive))),
);
// → "PostNotFound"
// #endregion cause

void [retryable, title];
await client.dispose();
