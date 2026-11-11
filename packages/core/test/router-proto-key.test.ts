// Regression: a computed `__proto__` key accepted by Router.make survives router.middleware.
import { Effect, Layer, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';
import { describe, expect, it } from 'vite-plus/test';
import { query, Router } from '../src/index.js';
import { LogMiddleware } from './fixtures.js';

const router = Router.make({ ['__proto__']: query({ success: Schema.String }) });
const handlers = { ['__proto__']: () => Effect.succeed('proto') };

describe('Router.make with a __proto__ key', () => {
  it('compiles the route and serves it without middleware (control)', async () => {
    expect([...router.procedures.keys()]).toEqual(['__proto__']);
    const result = await Effect.runPromise(
      RpcTest.makeClient(router.group).pipe(
        Effect.flatMap((client) => client['__proto__']()),
        Effect.scoped,
        Effect.provide(router.group.toLayer(handlers)),
      ),
    );
    expect(result).toBe('proto');
  });

  it('keeps the route when middleware is applied, with the middleware attached', async () => {
    const withLog = router.middleware(LogMiddleware);
    expect(Object.hasOwn(withLog.record, '__proto__')).toBe(true);
    expect([...withLog.procedures.keys()]).toEqual(['__proto__']);
    expect([...withLog.procedures.get('__proto__')!.rpc.middlewares]).toEqual([LogMiddleware]);
    const log: Array<string> = [];
    const LogLive = Layer.succeed(LogMiddleware)(
      LogMiddleware.of((effect) =>
        Effect.andThen(
          Effect.sync(() => log.push('log')),
          effect,
        ),
      ),
    );
    const result = await Effect.runPromise(
      RpcTest.makeClient(withLog.group).pipe(
        Effect.flatMap((client) => client['__proto__']()),
        Effect.scoped,
        Effect.provide(Layer.merge(withLog.group.toLayer(handlers), LogLive)),
      ),
    );
    expect(result).toBe('proto');
    expect(log).toEqual(['log']);
  });
});
