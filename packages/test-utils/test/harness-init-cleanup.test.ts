import { Effect, Layer, Schema } from 'effect';
import { query, Router } from '@rpc-effect/core';
import { Handlers } from '@rpc-effect/server';
import { describe, expect, it } from 'vite-plus/test';
import { assertInstance, testServerAndClient, testWebHandler } from '../src/index.js';
import { rejectionOf } from './helpers.js';

// Valid to serve, but `$effect` is reserved by `createClient` and `$promise` by `createCaller`.
const clientReserved = Router.make({ $effect: query({ success: Schema.String }) });
const callerReserved = Router.make({ $promise: query({ success: Schema.String }) });

const ok = () => Effect.succeed('ok');

/** A layer that counts how often the handlers are built and released. */
const counting = (counts: { acquired: number; released: number }) =>
  Layer.effectDiscard(
    Effect.acquireRelease(
      Effect.sync(() => counts.acquired++),
      () => Effect.sync(() => counts.released++),
    ),
  );

describe('harness initialization failure', () => {
  it('testWebHandler releases the web handler when the client cannot be created', async () => {
    const counts = { acquired: 0, released: 0 };
    const handlers = Layer.merge(Handlers.make(clientReserved, { $effect: ok }), counting(counts));
    const error = await rejectionOf(testWebHandler(clientReserved, { handlers }));
    assertInstance(error, Error);
    expect(error.message).toMatch(/createClient: .*"\$effect" is reserved/);
    expect(counts).toEqual({ acquired: 1, released: 1 });
  });

  it('testServerAndClient releases the server and web handler when the client cannot be created', async () => {
    const counts = { acquired: 0, released: 0 };
    const handlers = Layer.merge(Handlers.make(clientReserved, { $effect: ok }), counting(counts));
    const error = await rejectionOf(testServerAndClient(clientReserved, { handlers }));
    assertInstance(error, Error);
    expect(error.message).toMatch(/createClient: .*"\$effect" is reserved/);
    expect(counts).toEqual({ acquired: 2, released: 2 });
  });

  it('testServerAndClient releases the server and web handler when the caller cannot be created', async () => {
    const counts = { acquired: 0, released: 0 };
    const handlers = Layer.merge(Handlers.make(callerReserved, { $promise: ok }), counting(counts));
    const error = await rejectionOf(testServerAndClient(callerReserved, { handlers }));
    assertInstance(error, Error);
    expect(error.message).toMatch(/createCaller: .*"\$promise" is reserved/);
    expect(counts).toEqual({ acquired: 2, released: 2 });
  });
});
