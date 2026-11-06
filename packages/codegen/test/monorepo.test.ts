// Schemas from other packages: a workspace package (symlinked into node_modules, resolved to its
// source, exported through a barrel and an `exports` subpath) and a published dependency
// (`.d.ts` in node_modules). The router imports neither schema class, so the generator must find
// the package import paths itself; the result type-checks and runs.
import { cpSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import type { Router } from '@effect-trpc/core';
import { createClient, httpLink } from '@effect-trpc/client';
import { Handlers, toWebHandler } from '@effect-trpc/server';
import { generate } from '../src/index.js';
import type { GenerateResult } from '../src/index.js';
import { copyFixture, removeDir, typeCheck } from './helpers.js';

let dir: string;
let app: string;
let result: GenerateResult;
const read = (file: string): string => readFileSync(path.join(app, file), 'utf8');
const load = async <T>(file: string): Promise<T> =>
  // oxlint-disable-next-line typescript/no-unsafe-return -- generated modules, type-checked by a test
  await import(pathToFileURL(path.join(app, file)).href);

beforeAll(() => {
  dir = copyFixture('mono');
  app = path.join(dir, 'app');
  mkdirSync(path.join(app, 'node_modules', '@fx'), { recursive: true });
  // A workspace package, linked the way pnpm links it.
  symlinkSync(path.join('..', '..', '..', 'models'), path.join(app, 'node_modules/@fx/models'));
  // A published package, installed as files.
  cpSync(path.join(dir, 'vendor/vendor-lib'), path.join(app, 'node_modules/vendor-lib'), {
    recursive: true,
  });
  result = generate({
    project: path.join(app, 'tsconfig.json'),
    routers: [path.join(app, 'router.ts')],
  });
});
afterAll(() => {
  removeDir(dir);
});

describe('schemas from other packages', () => {
  it('generates with no errors', () => {
    expect(result.errors).toEqual([]);
  });

  it('imports them by package name: barrel, exports subpath, published dependency', () => {
    for (const file of ['router.gen.ts', 'router.client.gen.ts']) {
      const source = read(file);
      expect(source).toMatch(/import \{ User as __i\d+ \} from '@fx\/models';/);
      expect(source).toMatch(/import \{ UserNotFound as __i\d+ \} from '@fx\/models\/errors';/);
      expect(source).toMatch(/import \{ Money as __i\d+ \} from 'vendor-lib';/);
      expect(source).not.toMatch(/models\/src|node_modules/);
    }
  });

  it('type-checks, including the client contract check', () => {
    expect(typeCheck(app)).toBe('');
  });

  it('runs: the client decodes the other packages’ classes and errors', async () => {
    type Mod<K extends string> = Readonly<Record<K, new (...args: never) => unknown>>;
    const models = await load<Mod<'User'>>('node_modules/@fx/models/src/index.ts');
    const errors = await load<Mod<'UserNotFound'>>('node_modules/@fx/models/src/errors.ts');
    const vendor = await load<Mod<'Money'>>('node_modules/vendor-lib/lib/index.js');
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
    const call = (name: string, input?: unknown): Promise<unknown> => {
      const procedure: unknown = Reflect.get(client, name);
      if (typeof procedure !== 'function') throw new Error(`no procedure ${name}`);
      const out: unknown = Reflect.apply(procedure, client, [input]);
      return Promise.resolve(out);
    };
    try {
      expect(await call('user', { id: 1 })).toBeInstanceOf(models.User);
      expect(await call('user', { id: 2 }).catch((e: unknown) => e)).toBeInstanceOf(
        errors.UserNotFound,
      );
      expect(await call('price')).toBeInstanceOf(vendor.Money);
    } finally {
      await client.dispose();
      await web.dispose();
    }
  });
});
