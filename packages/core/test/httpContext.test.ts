import { Effect, Exit, Option } from 'effect';
import { describe, expect, it } from 'vite-plus/test';
import { HttpContext } from '../src/index.js';

describe('HttpContext outside HTTP', () => {
  it('has no request', async () => {
    expect(Option.isNone(await Effect.runPromise(HttpContext.request))).toBe(true);
  });

  it('setters are no-ops', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* HttpContext.setHeader('x-a', '1');
        yield* HttpContext.appendHeader('x-b', '1');
        yield* HttpContext.setCookie('session', 'abc', { httpOnly: true, path: '/' });
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it('an invalid cookie is a defect', async () => {
    const exit = await Effect.runPromiseExit(HttpContext.setCookie('bad name', 'x'));
    expect(Exit.hasDies(exit)).toBe(true);
  });
});
