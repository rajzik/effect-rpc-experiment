// Same-named bindings from different modules: nested routers a.ts and b.ts each declare a local
// `Input` (a string field, a number field), c.ts imports a third one, and b.ts imports `Schema`
// from another module than a.ts. The client module keeps them distinct, type-checks and decodes
// each input with its own schema.
import { readFileSync } from 'node:fs';
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
  dir = copyFixture('binding-identity');
  result = generate({
    project: path.join(dir, 'tsconfig.json'),
    routers: [path.join(dir, 'router.ts')],
  });
});
afterAll(() => {
  removeDir(dir);
});

describe('same-named bindings from different modules', () => {
  it('copies each one under its own name', () => {
    expect(result.errors).toEqual([]);
    const client = readFileSync(path.join(dir, 'router.client.gen.ts'), 'utf8');
    expect(client).toContain('const Input = Schema.Struct({ text: Schema.String });');
    expect(client).toContain('const Input_2 = Schema_2.Struct({ count: Schema_2.Finite });');
    expect(client).toContain("import { Input as Input_3, Schema as Schema_2 } from './models.js';");
    expect(client).toContain('echo: __query({ payload: Input, success: __Schema.String })');
    expect(client).toContain('double: __query({ payload: Input_2, success: __Schema.Number })');
    expect(client).toContain('negate: __query({ payload: Input_3, success: __Schema.Boolean })');
  });

  it('type-checks, including the client contract check', () => {
    expect(typeCheck(dir)).toBe('');
  });

  it('is stable: a second run changes nothing', () => {
    const again = generate({
      project: path.join(dir, 'tsconfig.json'),
      routers: [path.join(dir, 'router.ts')],
      write: false,
    });
    expect(again.files.every((f) => !f.changed)).toBe(true);
  });

  it('decodes each input with its own schema', async () => {
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
    // The routers are loaded at runtime, so the client is untyped here: call it by path.
    const call = (group: string, name: string, input: unknown): Promise<unknown> => {
      const routes: unknown = Reflect.get(client, group);
      const procedure: unknown =
        typeof routes === 'function' ? Reflect.get(routes, name) : undefined;
      if (typeof procedure !== 'function') throw new Error(`no procedure ${group}.${name}`);
      const out: unknown = Reflect.apply(procedure, routes, [input]);
      return Promise.resolve(out);
    };
    try {
      expect(await call('a', 'echo', { text: 'hi' })).toBe('hi');
      expect(await call('b', 'double', { count: 2 })).toBe(4);
      expect(await call('c', 'negate', { flag: true })).toBe(false);
    } finally {
      await client.dispose();
      await web.dispose();
    }
  });
});
