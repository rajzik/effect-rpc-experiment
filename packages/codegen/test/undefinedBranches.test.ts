// Issue #13: a handler that succeeds with `undefined` in one branch and a value in another keeps
// the `undefined` branch in its generated output schema, so both branches cross the HTTP path.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import type { Router, RouterService } from '@rpc-effect/core';
import { createClient, httpLink } from '@rpc-effect/client';
import { Handlers, toWebHandler } from '@rpc-effect/server';
import { generate } from '../src/index.js';
import type { GenerateResult } from '../src/index.js';
import { copyFixture, removeDir, typeCheck } from './helpers.js';

let dir: string;
let result: GenerateResult;
const load = async <T>(file: string): Promise<T> =>
  // oxlint-disable-next-line typescript/no-unsafe-return -- generated modules, type-checked by a test
  await import(pathToFileURL(path.join(dir, file)).href);

beforeAll(() => {
  dir = copyFixture('undefined-branches');
  result = generate({
    project: path.join(dir, 'tsconfig.json'),
    routers: [path.join(dir, 'router.ts')],
  });
});
afterAll(() => {
  removeDir(dir);
});

describe('success branches that are undefined', () => {
  it('keeps undefined next to a valued branch, and no output when every branch is void-like', () => {
    expect(result.errors).toEqual([]);
    const byPath = new Map(result.procedures.map((p) => [p.path, p]));
    expect(byPath.get('maybe')?.output).toBe('__Schema.UndefinedOr(__Schema.Number)');
    expect(byPath.get('none')?.output).toBeUndefined();
  });

  it('type-checks, including the client contract check', () => {
    expect(typeCheck(dir)).toBe('');
  });

  it('both branches succeed over HTTP', async () => {
    const server = await load<{ readonly AppRouter: RouterService.Pure }>('router.gen.ts');
    const contract = await load<{ readonly AppRouter: Router.Any }>('router.client.gen.ts');
    const web = await toWebHandler(server.AppRouter, {
      handlers: Handlers.fromService(server.AppRouter),
    });
    const client = createClient(contract.AppRouter, {
      link: httpLink({
        url: 'http://localhost/rpc',
        fetch: (input, init) => web.handler(new Request(input, init)),
      }),
    });
    // The routers are loaded at runtime, so the client is untyped here: call it by name.
    const call = (name: string, input: unknown): Promise<unknown> => {
      const procedure: unknown = Reflect.get(client, name);
      if (typeof procedure !== 'function') throw new Error(`no procedure ${name}`);
      return Promise.resolve(Reflect.apply(procedure, client, [input]));
    };
    try {
      expect(await call('maybe', { empty: true })).toBeUndefined();
      expect(await call('maybe', { empty: false })).toBe(1);
      expect(await call('none', { empty: true })).toBeUndefined();
      expect(await call('none', { empty: false })).toBeUndefined();
    } finally {
      await client.dispose();
      await web.dispose();
    }
  });
});
