// Ports of tRPC tests/server/streaming.test.ts and the stream regressions
// issue-5945-stream-null and issue-6461-stream-error.
import { Chunk, Effect, Exit, Stream } from 'effect';
import { causeToClientError } from '@effect-trpc/core';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { createCaller } from '../src/index.js';
import type { Caller } from '../src/index.js';
import { runServer } from '../src/node.js';
import type { RunningServer } from '../src/node.js';
import {
  appRouter,
  getCause,
  getSuccess,
  makeServer,
  NotFound,
  rejection,
  User,
} from './fixtures.js';
import type { AppRouter, Probe } from './fixtures.js';
import { withHttpClient } from './http-client.js';

let server: RunningServer;
let caller: Caller<AppRouter>;
let serverProbe: Probe;
let callerProbe: Probe;

beforeEach(async () => {
  const forServer = makeServer();
  const forCaller = makeServer();
  serverProbe = forServer.probe;
  callerProbe = forCaller.probe;
  server = await runServer(appRouter, { handlers: forServer.layer, port: 0 });
  caller = createCaller(appRouter, { handlers: forCaller.layer });
});

afterEach(async () => {
  await caller.dispose();
  await server.dispose();
});

describe('streaming (streaming.test.ts)', () => {
  it('streams class instances over HTTP', async () => {
    const exit = await withHttpClient(server.url, (client) =>
      Stream.runCollect(client['user.list']({ count: 4 })),
    );
    const users = getSuccess(exit);
    expect(users).toHaveLength(4);
    expect(users.every((u) => u instanceof User && u.createdAt instanceof Date)).toBe(true);
  });

  it('an empty stream completes', async () => {
    const exit = await withHttpClient(server.url, (client) =>
      Stream.runCollect(client['user.list']({ count: 0 })),
    );
    expect(getSuccess(exit)).toEqual([]);
  });

  it('taking a prefix of an infinite stream cancels it on the server', async () => {
    const exit = await withHttpClient(server.url, (client) =>
      Stream.runCollect(client['debug.infinite']().pipe(Stream.take(3))),
    );
    expect(getSuccess(exit)).toEqual([0, 1, 2]);
    await serverProbe.infiniteFinalized;
  });

  it('in-process: interrupting the consumer finalizes the producer', async () => {
    const taken = await Effect.runPromise(
      Stream.runCollect(caller.debug.infinite().pipe(Stream.take(5))),
    );
    expect(Chunk.fromIterable(taken).length).toBe(5);
    await callerProbe.infiniteFinalized;
  });
});

describe('issue-5945: null values in streams', () => {
  it('keeps nulls over HTTP', async () => {
    const exit = await withHttpClient(server.url, (client) =>
      Stream.runCollect(client['debug.nullable']()),
    );
    expect(getSuccess(exit)).toEqual([1, null, 2, null]);
  });

  it('keeps nulls in-process (async iterable)', async () => {
    const values: Array<number | null> = [];
    for await (const value of caller.$promise.debug.nullable()) values.push(value);
    expect(values).toEqual([1, null, 2, null]);
  });
});

describe('issue-6461: typed error in the middle of a stream', () => {
  it('delivers the elements, then the error instance, over HTTP', async () => {
    const seen: Array<number> = [];
    const exit = await withHttpClient(server.url, (client) =>
      Stream.runForEach(client['debug.failMidStream'](), (n) => Effect.sync(() => seen.push(n))),
    );
    expect(seen).toEqual([1, 2]);
    expect(Exit.isFailure(exit)).toBe(true);
    const error = causeToClientError(getCause(exit));
    expect(error).toBeInstanceOf(NotFound);
    expect(error).toMatchObject({ id: 'stream' });
  });

  it('the async iterable throws the error instance after the elements', async () => {
    const seen: Array<number> = [];
    const error = await rejection(
      (async () => {
        for await (const n of caller.$promise.debug.failMidStream()) seen.push(n);
      })(),
    );
    expect(seen).toEqual([1, 2]);
    expect(error).toBeInstanceOf(NotFound);
  });

  it('the Effect stream fails with the typed error', async () => {
    const error = await Effect.runPromise(
      Effect.flip(Stream.runDrain(caller.debug.failMidStream())),
    );
    expect(error).toBeInstanceOf(NotFound);
  });
});
