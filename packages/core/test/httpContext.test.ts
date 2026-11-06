import { Effect, Exit, Option } from 'effect';
import { HttpEffect, HttpServerResponse } from 'effect/http';
import { describe, expect, it } from 'vite-plus/test';
import { HttpContext } from '../src/index.js';

describe('HttpContext outside HTTP', () => {
  it('has no request', async () => {
    expect(Option.isNone(await Effect.runPromise(HttpContext.request))).toBe(true);
  });

  it('valid setters are no-ops', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* HttpContext.setHeader('x-a', '1');
        yield* HttpContext.appendHeader('x-b', '1');
        yield* HttpContext.setCookie('session', 'abc', { httpOnly: true, path: '/' });
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it('invalid input is a defect', async () => {
    expect(Exit.hasDies(await Effect.runPromiseExit(HttpContext.setCookie('bad name', 'x')))).toBe(
      true,
    );
    expect(Exit.hasDies(await Effect.runPromiseExit(HttpContext.setHeader('bad name', 'x')))).toBe(
      true,
    );
    expect(Exit.hasDies(await Effect.runPromiseExit(HttpContext.appendHeader('x-a', 'a\nb')))).toBe(
      true,
    );
  });
});

describe('HttpContext in an Effect HTTP app', () => {
  const handler = HttpEffect.toWebHandler(
    HttpContext.setHeader('x-a', '1').pipe(Effect.as(HttpServerResponse.empty())),
  );

  it('sets the header of a plain request', async () => {
    const response = await handler(new Request('http://localhost/'));
    expect(response.headers.get('x-a')).toBe('1');
  });

  it('registers nothing on a WebSocket upgrade request', async () => {
    const response = await handler(
      new Request('http://localhost/', { headers: { upgrade: 'websocket' } }),
    );
    expect(response.headers.get('x-a')).toBeNull();
  });
});
