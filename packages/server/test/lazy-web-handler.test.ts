// `makeLazyWebHandler`: the lazy build / retry / dispose lifecycle shared by the Next and Start
// adapters, exercised with real `toWebHandler` builds and handler-layer finalizers.
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vite-plus/test';
import { makeLazyWebHandler, toWebHandler } from '../src/index.js';
import { appRouter, makeServer } from './fixtures.js';
import { call, exitFrame, rpcRequest } from './wire.js';

/** Real web handlers of `appRouter` whose layer runs `acquire` / `release`; counts builds. */
const makeBuild = (acquire: Effect.Effect<void> = Effect.void, release = Effect.void) => {
  const counts = { builds: 0, released: 0 };
  const lifecycle = Layer.effectDiscard(
    Effect.acquireRelease(acquire, () =>
      Effect.sync(() => {
        counts.released++;
      }).pipe(Effect.andThen(release)),
    ),
  );
  const build = () => {
    counts.builds++;
    return toWebHandler(appRouter, { handlers: Layer.merge(makeServer().layer, lifecycle) });
  };
  return { counts, build };
};

/** A promise the test resolves to let a pending build finish. */
const makeGate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
};

describe('makeLazyWebHandler', () => {
  it('builds nothing until get(), then shares one build between concurrent and later calls', async () => {
    const { counts, build } = makeBuild();
    const lazy = makeLazyWebHandler(build);
    expect(counts.builds).toBe(0);
    const [first, second] = await Promise.all([lazy.get(), lazy.get()]);
    expect(second).toBe(first);
    expect(await lazy.get()).toBe(first);
    expect(counts.builds).toBe(1);
    expect(exitFrame(await call(first, { tag: 'health' }))).toEqual({
      _tag: 'Success',
      value: 'ok',
    });
    await lazy.dispose();
    expect(counts).toEqual({ builds: 1, released: 1 });
  });

  it('a failed build rejects every waiting caller; the next get() builds again', async () => {
    let attempts = 0;
    const { counts, build } = makeBuild(
      Effect.suspend(() =>
        attempts++ === 0 ? Effect.die(new Error('database down')) : Effect.void,
      ),
    );
    await using lazy = makeLazyWebHandler(build);
    const first = lazy.get();
    const second = lazy.get();
    await expect(first).rejects.toThrow(/database down/);
    await expect(second).rejects.toThrow(/database down/);
    expect(counts.builds).toBe(1);
    const web = await lazy.get();
    expect(counts.builds).toBe(2);
    expect(exitFrame(await call(web, { tag: 'health' }))).toEqual({ _tag: 'Success', value: 'ok' });
  });

  it('dispose() before the first get() builds nothing and refuses later builds', async () => {
    const { counts, build } = makeBuild();
    const lazy = makeLazyWebHandler(build);
    const disposing = lazy.dispose();
    expect(lazy.isDisposed()).toBe(true);
    await disposing;
    await expect(lazy.get()).rejects.toThrow(/disposed/);
    expect(counts).toEqual({ builds: 0, released: 0 });
  });

  it('dispose() during a successful build waits for it and disposes the result once', async () => {
    const gate = makeGate();
    const { counts, build } = makeBuild(Effect.promise(() => gate.opened));
    const lazy = makeLazyWebHandler(build);
    const pending = lazy.get();
    const disposing = lazy.dispose();
    // closed immediately, before the pending build settles
    expect(lazy.isDisposed()).toBe(true);
    await expect(lazy.get()).rejects.toThrow(/disposed/);
    gate.open();
    await disposing;
    expect(counts).toEqual({ builds: 1, released: 1 });
    // a caller that was already waiting still gets the handler, which now answers 503
    const web = await pending;
    expect((await web.handler(rpcRequest([{ tag: 'health' }]))).status).toBe(503);
    await lazy.dispose();
    expect(counts).toEqual({ builds: 1, released: 1 });
  });

  it('dispose() during a failed build resolves and never builds again', async () => {
    const gate = makeGate();
    const { counts, build } = makeBuild(
      Effect.promise(() => gate.opened).pipe(
        Effect.andThen(Effect.die(new Error('database down'))),
      ),
    );
    const lazy = makeLazyWebHandler(build);
    const pending = lazy.get();
    const disposing = lazy.dispose();
    gate.open();
    await expect(pending).rejects.toThrow(/database down/);
    await disposing;
    await expect(lazy.get()).rejects.toThrow(/disposed/);
    expect(counts).toEqual({ builds: 1, released: 0 });
  });

  it('repeated dispose() returns the same promise and releases the layer once', async () => {
    const { counts, build } = makeBuild();
    const lazy = makeLazyWebHandler(build);
    await lazy.get();
    const first = lazy.dispose();
    expect(lazy.dispose()).toBe(first);
    await first;
    await lazy[Symbol.asyncDispose]();
    expect(counts).toEqual({ builds: 1, released: 1 });
  });

  it('a failing disposal rejects every dispose() call with that error', async () => {
    const { counts, build } = makeBuild(Effect.void, Effect.die(new Error('release failed')));
    const lazy = makeLazyWebHandler(build);
    await lazy.get();
    await expect(lazy.dispose()).rejects.toThrow(/release failed/);
    await expect(lazy.dispose()).rejects.toThrow(/release failed/);
    expect(counts).toEqual({ builds: 1, released: 1 });
  });
});
