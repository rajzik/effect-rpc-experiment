import { Effect, Exit, Option, Schema, Stream } from 'effect';
import { HttpContext, Procedure, Router } from '@effect-trpc/core';
import { describe, expect, it } from 'vite-plus/test';
import { createCaller, Handlers, toWebHandler } from '../src/index.js';
import { call, exitFrame, readFrames, rpcRequest } from './wire.js';

let release: () => void = () => {};
const released = new Promise<void>((resolve) => {
  release = resolve;
});

const router = Router.make({
  whoami: Procedure.output(Schema.String).query(() =>
    Effect.map(
      HttpContext.request,
      Option.match({
        onNone: () => 'none',
        onSome: (req) => `${req.method} ${new URL(req.url, 'http://x').pathname}`,
      }),
    ),
  ),
  login: Procedure.mutation(() =>
    Effect.gen(function* () {
      yield* HttpContext.setHeader('x-a', '1');
      yield* HttpContext.appendHeader('x-b', '1');
      yield* HttpContext.appendHeader('x-b', '2');
      yield* HttpContext.setCookie('session', 'abc', { httpOnly: true, path: '/' });
    }),
  ),
  badCookie: Procedure.mutation(() => HttpContext.setCookie('bad name', 'x')),
  late: Procedure.output(Schema.Finite).subscription(() =>
    Stream.make(1).pipe(
      Stream.concat(
        Stream.fromEffect(
          Effect.promise(() => released).pipe(
            Effect.andThen(HttpContext.setHeader('x-late', '1')),
            Effect.as(2),
          ),
        ),
      ),
    ),
  ),
});

const handlers = Handlers.fromProcedures(router);

describe('HttpContext over toWebHandler', () => {
  it('reads the request', async () => {
    await using web = await toWebHandler(router, { handlers });
    const frames = await call(web, { tag: 'whoami' });
    expect(exitFrame(frames)).toEqual({ _tag: 'Success', value: 'POST /rpc' });
  });

  it('sets headers and cookies', async () => {
    await using web = await toWebHandler(router, { handlers });
    const response = await web.handler(rpcRequest([{ tag: 'login' }]));
    expect(response.headers.get('x-a')).toBe('1');
    expect(response.headers.get('x-b')).toBe('1, 2');
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain('session=abc');
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[0]).toContain('Path=/');
    expect(exitFrame(await readFrames(response))).toMatchObject({ _tag: 'Success' });
  });

  it('an invalid cookie is a defect of the call', async () => {
    await using web = await toWebHandler(router, { handlers });
    const frames = await call(web, { tag: 'badCookie' });
    expect(exitFrame(frames)).toMatchObject({
      _tag: 'Failure',
      cause: [{ _tag: 'Die' }],
    });
  });

  it('subscription header after first element is ignored', async () => {
    await using web = await toWebHandler(router, { handlers });
    // The response (and its headers) exists once the first element is written.
    const response = await web.handler(rpcRequest([{ tag: 'late' }]));
    release();
    expect(response.headers.get('x-late')).toBeNull();
    const frames = await readFrames(response);
    const chunks = frames.filter((f) => f._tag === 'Chunk').flatMap((f) => f.values ?? []);
    expect(chunks).toEqual([1, 2]);
    expect(frames.at(-1)).toMatchObject({ _tag: 'Exit', exit: { _tag: 'Success' } });
  });
});

describe('HttpContext without HTTP', () => {
  it('caller has no request', async () => {
    await using caller = createCaller(router, { handlers });
    expect(await caller.$promise.whoami()).toBe('none');
    expect(await caller.$promise.login()).toBeUndefined();
  });

  it('caller still dies on an invalid cookie', async () => {
    await using caller = createCaller(router, { handlers });
    const exit = await Effect.runPromiseExit(caller.badCookie());
    expect(Exit.hasDies(exit)).toBe(true);
  });
});
