// A generic recursive type returned as concrete instantiations (`Tree<string>`, `Tree<Label>`):
// the hoisted and suspended schema annotations keep the type arguments, so the generated modules
// type-check and recursive values round-trip through the generated schemas.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { createClient, httpLink } from '@rpc-effect/client';
import { Handlers, toWebHandler } from '@rpc-effect/server';
import { generate } from '../src/index.js';
import type { GenerateResult } from '../src/index.js';
import { copyFixture, fixtureDir, removeDir, typeCheck } from './helpers.js';
import { AppRouter as ClientRouter } from './fixtures/recursive-generic/router.client.gen.js';
import { AppRouter as ServerRouter } from './fixtures/recursive-generic/router.gen.js';

describe('recursive generic types', () => {
  let dir: string;
  let out: GenerateResult;
  beforeAll(() => {
    dir = copyFixture('recursive-generic');
    out = generate({
      project: path.join(dir, 'tsconfig.json'),
      routers: [path.join(dir, 'router.ts')],
    });
  });
  afterAll(() => {
    removeDir(dir);
  });

  it('the hoisted and suspended annotations keep the concrete type arguments', () => {
    expect(out.errors).toEqual([]);
    for (const file of ['router.gen.ts', 'router.client.gen.ts']) {
      const text = readFileSync(path.join(dir, file), 'utf8');
      expect(text).toContain("import type { Tree as __i1, Label as __i4 } from './models.js';");
      expect(text).toContain(
        'const __r0: __Schema.Codec<__i1<string>, unknown> = __Schema.Struct({ value: __Schema.String, children: __Schema.mutable(__Schema.Array(__Schema.suspend((): __Schema.Codec<__i1<string>, unknown> => __r0))) });',
      );
      expect(text).toContain(
        'const __r2: __Schema.Codec<__i1<__i4>, unknown> = __Schema.Struct({ value: __Schema.Struct({ text: __Schema.String }), children: __Schema.mutable(__Schema.Array(__Schema.suspend((): __Schema.Codec<__i1<__i4>, unknown> => __r2))) });',
      );
    }
  });

  it('type-checks, including the client contract check', () => {
    expect(typeCheck(dir)).toBe('');
  });

  it('the committed fixture output is up to date', () => {
    const fresh = generate({
      project: path.join(fixtureDir('recursive-generic'), 'tsconfig.json'),
      routers: [path.join(fixtureDir('recursive-generic'), 'router.ts')],
      write: false,
    });
    expect(fresh.errors).toEqual([]);
    expect(fresh.files.filter((f) => f.changed).map((f) => f.path)).toEqual([]);
  });

  it('a handler that leaves the type parameter unresolved is still an error', () => {
    const unresolved = generate({
      project: path.join(dir, 'tsconfig.json'),
      routers: [path.join(dir, 'unresolved.ts')],
      write: false,
    });
    expect(unresolved.files).toEqual([]);
    expect(unresolved.errors.join('\n')).toMatch(
      /unresolved\.ts:\d+: the type parameter T has no schema \(make the handler concrete\)/,
    );
  });

  it('recursive values are encoded by the server module and decoded by the client module', async () => {
    await using web = await toWebHandler(ServerRouter, {
      handlers: Handlers.fromProcedures(ServerRouter),
    });
    await using client = createClient(ClientRouter, {
      link: httpLink({
        url: 'http://localhost/rpc',
        fetch: (input, init) => web.handler(new Request(input, init)),
      }),
    });
    expect(await client.words()).toEqual({
      value: 'root',
      children: [{ value: 'child', children: [{ value: 'leaf', children: [] }] }],
    });
    expect(await client.labels()).toEqual({
      value: { text: 'root' },
      children: [{ value: { text: 'leaf' }, children: [] }],
    });
  });
});
