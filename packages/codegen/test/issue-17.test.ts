// Issue #17: the client module declares copied schemas after the schemas they read, including
// through a cycle, so it type-checks and imports without a temporal-dead-zone error.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import type { Router } from '@rpc-effect/core';
import { generate } from '../src/index.js';
import type { GenerateResult } from '../src/index.js';
import { copyFixture, removeDir, typeCheck } from './helpers.js';

let dir: string;
let result: GenerateResult;

beforeAll(() => {
  dir = copyFixture('issue-17');
  result = generate({
    project: path.join(dir, 'tsconfig.json'),
    routers: [path.join(dir, 'router.ts')],
  });
});
afterAll(() => {
  removeDir(dir);
});

describe('copied schemas that use other copied schemas', () => {
  it('generates with no errors', () => {
    expect(result.errors).toEqual([]);
  });

  it('type-checks: each copied schema is declared after the schemas it reads', () => {
    expect(typeCheck(dir)).toBe('');
  });

  it('the client module imports', async () => {
    const client: { readonly AppRouter: Router.Any } = await import(
      pathToFileURL(path.join(dir, 'router.client.gen.ts')).href
    );
    expect([...client.AppRouter.procedures.keys()]).toEqual(['byId', 'tree']);
  });
});
