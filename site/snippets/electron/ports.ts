// Generic MessagePort building blocks: utility processes, workers, custom handshakes.
import { Effect } from 'effect';
import { createClient } from '@effect-trpc/client';
import { MessagePortServer, messagePortLink } from '@effect-trpc/electron';

import { appRouter } from '@/router';
import { ServerLive } from '@/server';

const { port1, port2 } = new MessageChannel();

// Server side: serve any number of ports.
const program = Effect.gen(function* () {
  const { attach } = yield* MessagePortServer.serve(appRouter, { handlers: ServerLive });
  yield* attach(port1, { headers: { 'x-origin': 'worker' } });
  return yield* Effect.never; // keep serving until the scope closes
});
void Effect.runFork(Effect.scoped(program));

// Client side: a link over the other end (or a factory, for one port per client).
const client = createClient(appRouter, { link: messagePortLink(port2) });
await client.health();
