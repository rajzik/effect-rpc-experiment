import { Duration, Effect, Fiber } from 'effect';
import { createClient, httpLink } from '@effect-trpc/client';
import { isClientInfrastructureError } from '@effect-trpc/core';

import { appRouter } from '@/router';

const client = createClient(appRouter, { link: httpLink({ url: 'https://api.example.com/rpc' }) });

// #region promise
// A deadline for one call.
try {
  await client.post.byId({ id: 1 }, { signal: AbortSignal.timeout(2_000) });
} catch (error) {
  if (isClientInfrastructureError(error) && error._tag === '@effect-trpc/RpcInterrupted') {
    console.log('timed out; the handler on the server was interrupted too');
  }
}

// One signal for a whole page's calls, e.g. aborted on navigation.
const page = new AbortController();
await Promise.all([
  client.post.byId({ id: 1 }, { signal: page.signal }),
  client.post.list({ cursor: null }, { signal: page.signal }),
]);
// #endregion promise

// #region effect
// Effect: timeouts and races interrupt the call, which interrupts the handler.
const withDeadline = client.$effect.post.byId({ id: 1 }).pipe(Effect.timeout(Duration.seconds(2))); // fails with TimeoutError after 2s

// The first answer wins; the slower call is interrupted on the server.
const fastest = Effect.raceFirst(
  client.$effect.post.byId({ id: 1 }),
  client.$effect.post.byId({ id: 2 }),
);

// Manual control with fibers.
const program = Effect.gen(function* () {
  const fiber = yield* Effect.forkChild(client.$effect.post.list({ cursor: null }));
  yield* Effect.sleep('100 millis');
  yield* Fiber.interrupt(fiber);
});
// #endregion effect

void [withDeadline, fastest, program];
