// The API generator covers every public export. The oracle is independent of the generator: the
// export lists of the built `dist/*.d.mts` files (run `vp run -r build` first).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';

const repo = join(import.meta.dirname, '..', '..');
const generator = join(repo, 'site', 'scripts', 'gen-api.mjs');

const pages = {
  core: ['core', 'index'],
  server: ['server', 'index'],
  'server-node': ['server', 'node'],
  client: ['client', 'index'],
  'tanstack-react-query': ['tanstack-react-query', 'index'],
  next: ['next', 'index'],
  start: ['start', 'index'],
  electron: ['electron', 'index'],
  'electron-main': ['electron', 'main'],
  'electron-preload': ['electron', 'preload'],
  'electron-renderer': ['electron', 'renderer'],
  'test-utils': ['test-utils', 'index'],
  codegen: ['codegen', 'index'],
  'codegen-vite': ['codegen', 'vite'],
} as const;

/** Exported names of a bundled declaration file: `export { … }` lists and `export declare …`. */
const dtsExports = (file: string): string[] => {
  const text = readFileSync(file, 'utf8');
  const listed = [...text.matchAll(/^export \{([^}]*)\};?$/gm)].flatMap((match) =>
    (match[1] ?? '')
      .split(',')
      .map((part) => part.trim().replace(/^type\s+/, ''))
      .filter((part) => part.length > 0)
      .map((part) => part.split(/\s+as\s+/).at(-1) ?? part),
  );
  const declared = [
    ...text.matchAll(
      /^export (?:declare )?(?:const|let|function|abstract class|class|interface|type|namespace|enum) ([A-Za-z_$][\w$]*)/gm,
    ),
  ].map((match) => match[1] ?? '');
  return [...new Set([...listed, ...declared])];
};

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

let out = '';
const page = (name: string): string => readFileSync(join(out, `${name}.md`), 'utf8');

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'effect-trpc-api-'));
  execFileSync(process.execPath, [generator, '--out', out], { cwd: repo, stdio: 'pipe' });
});

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

describe('gen-api', () => {
  it('refuses to clear an --out folder it did not create', () => {
    const foreign = mkdtempSync(join(tmpdir(), 'effect-trpc-foreign-'));
    writeFileSync(join(foreign, 'keep.txt'), 'user data');
    try {
      expect(() =>
        execFileSync(process.execPath, [generator, '--out', foreign], { cwd: repo, stdio: 'pipe' }),
      ).toThrow(/refusing to clear/);
      expect(readFileSync(join(foreign, 'keep.txt'), 'utf8')).toBe('user data');
    } finally {
      rmSync(foreign, { recursive: true, force: true });
    }
  });

  it('rejects --out without a value', () => {
    expect(() =>
      execFileSync(process.execPath, [generator, '--out'], { cwd: repo, stdio: 'pipe' }),
    ).toThrow(/--out/);
  });

  it('writes one page per package entry, and none for e2e', () => {
    const files = readdirSync(out)
      .filter((file) => !file.startsWith('.'))
      .toSorted();
    expect(files).toEqual(
      [...Object.keys(pages).map((name) => `${name}.md`), 'index.md'].toSorted(),
    );
    expect(existsSync(join(out, 'e2e.md'))).toBe(false);
  });

  it.each(Object.entries(pages))('%s.md anchors every export of its dist entry', (name, entry) => {
    const [pkg, file] = entry;
    const names = dtsExports(join(repo, 'packages', pkg, 'dist', `${file}.d.mts`));
    expect(names.length).toBeGreaterThan(0);
    const text = page(name);
    expect(names.filter((exported) => !text.includes(`{#${slug(exported)}}`))).toEqual([]);
  });

  it.each(Object.keys(pages))('%s.md has no duplicate anchors', (name) => {
    const anchors = [...page(name).matchAll(/\{#([a-z0-9-]+)\}/g)].map((match) => match[1]);
    expect(anchors.filter((anchor, i) => anchors.indexOf(anchor) !== i)).toEqual([]);
  });

  it('documents namespace and value-object members', () => {
    const core = page('core');
    for (const anchor of [
      'router-make',
      'router-ispath',
      'router-childpath',
      'router-merge',
      'router-any',
      'codecs-encodesuccesssync',
    ]) {
      expect(core).toContain(`{#${anchor}}`);
    }
    expect(page('server')).toContain('{#handlers-make}');
    expect(page('server')).toContain('{#createcaller}');
  });

  it('links {@link sibling} inside a namespace to the sibling member', () => {
    expect(page('core')).toContain('[`childPath`](#router-childpath)');
  });

  it('renders the JSDoc sections, signatures and since tags', () => {
    const client = page('client');
    expect(client).toContain('**When to use**');
    expect(client).toContain('**Gotchas**');
    expect(client).toMatch(/```ts\n[^`]*createClient/);
    expect(client).toContain('Since 0.1.0');
  });

  it('escapes prose so Vue does not parse type parameters as tags', () => {
    for (const name of Object.keys(pages)) {
      const prose = page(name)
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`\n]*`/g, '');
      expect(prose).not.toMatch(/<[A-Z][A-Za-z]*[>,\s]/);
    }
  });
});
