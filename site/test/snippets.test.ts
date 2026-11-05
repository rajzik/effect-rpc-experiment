// Every guide sample is a type-checked file under snippets/ that some page imports, and no page
// ships placeholder text.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

const site = join(import.meta.dirname, '..');
const snippetsDir = join(site, 'snippets');

const walk = (dir: string, skip: ReadonlyArray<string>): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (skip.includes(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path, skip) : [path];
  });

const pages = walk(site, [
  'node_modules',
  '.vitepress',
  'api',
  'snippets',
  'test',
  'scripts',
]).filter((file) => file.endsWith('.md') && !file.endsWith('README.md'));

/** `<<< @/snippets/x/y.ts#region{1,2} [title]` → `x/y.ts`. */
const referenced = new Set(
  pages.flatMap((page) =>
    [...readFileSync(page, 'utf8').matchAll(/^<<< @\/snippets\/([^\s#{[]+)/gm)].map(
      (match) => match[1] ?? '',
    ),
  ),
);

const snippets = walk(snippetsDir, ['node_modules'])
  .map((file) => relative(snippetsDir, file))
  .filter((file) => /\.tsx?$/.test(file) && !file.startsWith('shared/'));

describe('snippets', () => {
  it('every snippet is used by a page', () => {
    expect(snippets.filter((file) => !referenced.has(file))).toEqual([]);
  });

  it('every referenced snippet exists', () => {
    expect([...referenced].filter((file) => !existsSync(join(snippetsDir, file)))).toEqual([]);
  });

  it('no page ships placeholder text', () => {
    const offenders = pages.filter((page) =>
      /\b(TODO|TBD|Coming soon|lorem ipsum)\b/i.test(readFileSync(page, 'utf8')),
    );
    expect(offenders.map((page) => relative(site, page))).toEqual([]);
  });
});
