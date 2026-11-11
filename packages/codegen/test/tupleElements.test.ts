// Tuples with optional and rest elements (issue #16): the generated schemas keep the element
// flags, so serving the generated modules accepts every value the handler types allow.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import type { Router } from '@rpc-effect/core';
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
  dir = copyFixture('tuple-elements');
  result = generate({
    project: path.join(dir, 'tsconfig.json'),
    routers: [path.join(dir, 'router.ts')],
  });
});
afterAll(() => {
  removeDir(dir);
});

describe('tuples with optional and rest elements', () => {
  it('generates and type-checks, including the client contract check', () => {
    expect(result.errors).toEqual([]);
    expect(typeCheck(dir)).toBe('');
  });

  it('the generated schemas accept the values the handlers return', async () => {
    const server = await load<{ readonly AppRouter: Router.Any }>('router.gen.ts');
    const contract = await load<{ readonly AppRouter: Router.Any }>('router.client.gen.ts');
    const web = await toWebHandler(server.AppRouter, {
      handlers: Handlers.fromProcedures(server.AppRouter),
    });
    const client = createClient(contract.AppRouter, {
      link: httpLink({
        url: 'http://localhost/rpc',
        fetch: (input, init) => web.handler(new Request(input, init)),
      }),
    });
    // The routers are loaded at runtime, so the client is untyped here: call it by name.
    const call = (name: string): Promise<unknown> => {
      const procedure: unknown = Reflect.get(client, name);
      if (typeof procedure !== 'function') throw new Error(`no procedure ${name}`);
      const out: unknown = Reflect.apply(procedure, client, []);
      return Promise.resolve(out);
    };
    try {
      expect(await call('optional')).toEqual([1]);
      expect(await call('rest')).toEqual([1, 'a', 'b']);
      expect(await call('trailing')).toEqual(['a', 'b', 1]);
    } finally {
      await client.dispose();
      await web.dispose();
    }
  });
});
