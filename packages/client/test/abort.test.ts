import { Effect, Fiber, Stream } from 'effect';
import { describe, expect, it } from 'vite-plus/test';
import {
  createClient,
  httpLink,
  localLink,
  RpcInterrupted,
  wsLink,
  type CreateClientOptions,
} from '../src/index.js';
import { appRouter, makeHandlers, makeProbe, type AppRouter } from './fixtures.js';
import { rejectionOf, within } from './helpers.js';
import { startServer } from './servers.js';

type Setup = (handlers: ReturnType<typeof makeHandlers>) => Promise<{
  readonly link: CreateClientOptions<AppRouter>['link'];
  readonly dispose: () => Promise<void>;
}>;

const setups: ReadonlyArray<readonly [string, Setup]> = [
  [
    'localLink',
    (handlers) => Promise.resolve({ link: localLink({ handlers }), dispose: async () => {} }),
  ],
  [
    'httpLink',
    async (handlers) => {
      const server = await startServer({ protocol: 'http', handlers });
      return { link: httpLink({ url: server.url }), dispose: server.dispose };
    },
  ],
  [
    'wsLink',
    async (handlers) => {
      const server = await startServer({ protocol: 'websocket', handlers });
      return { link: wsLink({ url: server.wsUrl }), dispose: server.dispose };
    },
  ],
];

describe.each(setups)('abort over %s', (_name, setup) => {
  const withClient = async (
    test: (
      client: ReturnType<typeof createClient<typeof appRouter>>,
      probe: ReturnType<typeof makeProbe>,
    ) => Promise<void>,
  ): Promise<void> => {
    const probe = makeProbe();
    const { link, dispose } = await setup(makeHandlers(probe));
    const client = createClient(appRouter, { link });
    try {
      await test(client, probe);
    } finally {
      await client.dispose();
      await dispose();
    }
  };

  it('rejects with RpcInterrupted and interrupts the server handler', () =>
    withClient(async (client, probe) => {
      const controller = new AbortController();
      const pending = rejectionOf(client.slow(undefined, { signal: controller.signal }));
      await within(probe.started);
      controller.abort();
      expect(await within(pending)).toBeInstanceOf(RpcInterrupted);
      await within(probe.interrupted);
      expect(probe.state.interrupted).toBe(1);
      // the link is still usable
      await expect(client.health()).resolves.toBe('ok');
    }));

  it('rejects immediately for an already aborted signal', () =>
    withClient(async (client) => {
      const error = await rejectionOf(client.health(undefined, { signal: AbortSignal.abort() }));
      expect(error).toBeInstanceOf(RpcInterrupted);
    }));

  it('interrupting an Effect-client fiber interrupts the server handler', () =>
    withClient(async (client, probe) => {
      const fiber = Effect.runFork(client.$effect.slow());
      await within(probe.started);
      await Effect.runPromise(Fiber.interrupt(fiber));
      await within(probe.interrupted);
      expect(probe.state.interrupted).toBe(1);
    }));

  it('aborting an async iterable throws RpcInterrupted and closes the server stream', () =>
    withClient(async (client, probe) => {
      const controller = new AbortController();
      const seen: Array<number> = [];
      let thrown: unknown;
      try {
        for await (const tick of client.forever(undefined, { signal: controller.signal })) {
          seen.push(tick);
          if (seen.length === 3) controller.abort();
        }
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(RpcInterrupted);
      expect(seen).toEqual([0, 1, 2]);
      await within(probe.streamClosed);
    }));

  it('breaking out of for-await ends the subscription', () =>
    withClient(async (client, probe) => {
      const seen: Array<number> = [];
      for await (const tick of client.forever()) {
        seen.push(tick);
        if (seen.length === 2) break;
      }
      expect(seen).toEqual([0, 1]);
      await within(probe.streamClosed);
      const taken = await Effect.runPromise(
        Stream.runCollect(Stream.take(client.$effect.forever(), 2)),
      );
      expect(taken).toEqual([0, 1]);
    }));

  it('dispose interrupts in-flight calls', () =>
    withClient(async (client, probe) => {
      const pending = rejectionOf(client.slow());
      await within(probe.started);
      await client.dispose();
      expect(await within(pending)).toBeInstanceOf(RpcInterrupted);
      await within(probe.interrupted);
    }));

  it('dispose ends an active subscription', () =>
    withClient(async (client, probe) => {
      const iterator = client.forever()[Symbol.asyncIterator]();
      await within(iterator.next());
      await client.dispose();
      const settled = await within(
        (async () => {
          try {
            for (;;) {
              const result = await iterator.next();
              if (result.done === true) return 'done';
            }
          } catch (error) {
            return error;
          }
        })(),
      );
      expect(settled === 'done' || settled instanceof Error).toBe(true);
      await within(probe.streamClosed);
    }));
});
