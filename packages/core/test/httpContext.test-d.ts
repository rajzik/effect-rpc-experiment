import type { Effect, Option } from 'effect';
import type { HttpServerRequest } from 'effect/http';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import { HttpContext } from '../src/index.js';

describe('HttpContext', () => {
  it('adds no requirements and no errors', () => {
    expectTypeOf(HttpContext.request).toEqualTypeOf<
      Effect.Effect<Option.Option<HttpServerRequest.HttpServerRequest>>
    >();
    expectTypeOf(HttpContext.setHeader('a', 'b')).toEqualTypeOf<Effect.Effect<void>>();
    expectTypeOf(HttpContext.appendHeader('a', 'b')).toEqualTypeOf<Effect.Effect<void>>();
    expectTypeOf(HttpContext.setCookie('a', 'b')).toEqualTypeOf<Effect.Effect<void>>();
  });
});
