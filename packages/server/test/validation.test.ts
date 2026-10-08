// Ports of tRPC tests/server/input.test.ts and tests/server/outputParser.test.ts.
// Schemas replace input/output parsers: an invalid payload fails to decode on the server and an
// invalid handler result fails to encode; both surface to the caller as a defect (Die), never
// as the procedure's typed error, and the server keeps serving.
import { Exit } from 'effect';
import { causeToClientError, RpcDefect } from '@effect-trpc/core';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { createCaller, toWebHandler } from '../src/index.js';
import type { Caller, WebHandler } from '../src/index.js';
import { runServer } from '../src/node.js';
import { appRouter, getCause, makeServer, rejection } from './fixtures.js';
import type { AppRouter } from './fixtures.js';
import { withHttpClient } from './http-client.js';
import { call, exitFrame } from './wire.js';

let web: WebHandler;
let caller: Caller<AppRouter>;

beforeEach(async () => {
  web = await toWebHandler(appRouter, { handlers: makeServer().layer });
  caller = createCaller(appRouter, { handlers: makeServer().layer });
});

afterEach(async () => {
  await web.dispose();
  await caller.dispose();
});

describe('input validation (input.test.ts)', () => {
  it('an invalid payload is answered with a Die describing the decode failure', async () => {
    const frames = await call(web, { tag: 'user.byId', payload: { id: 42 } });
    expect(exitFrame(frames)).toEqual({
      _tag: 'Failure',
      cause: [{ _tag: 'Die', defect: 'Expected string\n  at ["id"]' }],
    });
  });

  it('a missing payload is a decode failure too', async () => {
    const frames = await call(web, { tag: 'user.create', payload: {} });
    expect(exitFrame(frames)).toMatchObject({ _tag: 'Failure', cause: [{ _tag: 'Die' }] });
  });

  it('the server keeps answering after a decode failure', async () => {
    await call(web, { tag: 'user.byId', payload: 'garbage' });
    const frames = await call(web, { tag: 'user.byId', payload: { id: 'ada' } });
    expect(exitFrame(frames)).toMatchObject({ _tag: 'Success', value: { id: 'ada' } });
  });

  it('the in-process caller validates input and rejects with RpcDefect', async () => {
    const invalid = { id: 42 } as unknown as { readonly id: string };
    const error = await rejection(caller.$promise.user.byId(invalid));
    expect(error).toBeInstanceOf(RpcDefect);
    expect(await caller.$promise.health()).toBe('ok');
  });
});

describe('output validation (outputParser.test.ts)', () => {
  it('a result violating the success schema is answered with a Die', async () => {
    const frames = await call(web, { tag: 'debug.badOutput' });
    expect(exitFrame(frames)).toEqual({
      _tag: 'Failure',
      cause: [{ _tag: 'Die', defect: 'Expected an integer\n  at ["value"]' }],
    });
    expect(exitFrame(await call(web, { tag: 'health' }))).toEqual({
      _tag: 'Success',
      value: 'ok',
    });
  });

  it('an RpcClient over HTTP sees the encode failure as RpcDefect', async () => {
    const server = await runServer(appRouter, { handlers: makeServer().layer, port: 0 });
    try {
      const exit = await withHttpClient(server.url, (client) => client['debug.badOutput']());
      expect(Exit.isFailure(exit)).toBe(true);
      const error = causeToClientError(getCause(exit));
      expect(error).toBeInstanceOf(RpcDefect);
      expect(error).toMatchObject({ message: expect.stringContaining('Expected an integer') });
    } finally {
      await server.dispose();
    }
  });
});
