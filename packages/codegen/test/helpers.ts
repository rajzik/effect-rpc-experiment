// Copies a fixture into `test/.tmp/` (inside the package, so `effect` and `@rpc-effect/*`
// resolve) and type-checks a directory with tsgo.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tsgo = path.resolve(here, '../../../node_modules/.bin/tsgo');

export const copyFixture = (name: string): string => {
  const root = path.join(here, '.tmp');
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(path.join(root, `${name}-`));
  cpSync(path.join(here, 'fixtures', name), dir, { recursive: true });
  return dir;
};

export const removeDir = (dir: string): void => {
  rmSync(dir, { recursive: true, force: true });
};

/** Type-checks a fixture directory; returns the diagnostics ('' when clean). */
export const typeCheck = (dir: string): string => {
  try {
    execFileSync(tsgo, ['-p', path.join(dir, 'tsconfig.json')], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return '';
  } catch (error) {
    const field = (key: 'stdout' | 'stderr'): string => {
      const value: unknown =
        typeof error === 'object' && error !== null ? Reflect.get(error, key) : undefined;
      return typeof value === 'string' ? value : '';
    };
    return `${field('stdout')}${field('stderr')}`;
  }
};

export const fixtureDir = (name: string): string => path.join(here, 'fixtures', name);
