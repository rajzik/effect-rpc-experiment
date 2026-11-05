// Checks the built site (`pnpm docs:build` first): every root-relative URL carries the Pages base.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

import { sidebar } from '../.vitepress/sidebar';

const dist = join(import.meta.dirname, '..', '.vitepress', 'dist');
const base = '/effect-rpc-experiment/';

const htmlFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? htmlFiles(join(dir, entry.name))
      : entry.name.endsWith('.html')
        ? [join(dir, entry.name)]
        : [],
  );

describe('built site', () => {
  it('has been built', () => {
    expect(existsSync(join(dist, 'index.html'))).toBe(true);
  });

  it('assets carry the base path', () => {
    const offenders = htmlFiles(dist).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/\s(?:href|src)="(\/[^"]*)"/g)]
        .map((match) => match[1] ?? '')
        .filter((url) => !url.startsWith(base))
        .map((url) => `${file.slice(dist.length)}: ${url}`),
    );
    expect(offenders).toEqual([]);
  });

  it('every sidebar and nav link has a page', () => {
    const links = Object.values(sidebar).flatMap((groups) =>
      (groups as ReadonlyArray<{ items?: ReadonlyArray<{ link?: string }> }>).flatMap((group) =>
        (group.items ?? []).map((item) => item.link ?? ''),
      ),
    );
    const missing = links.filter((link) => {
      const path = link.endsWith('/') ? `${link}index.html` : `${link}.html`;
      return !existsSync(join(dist, path));
    });
    expect(links.length).toBeGreaterThan(40);
    expect(missing).toEqual([]);
  });

  // VitePress's dead-link check ignores `#fragments`: check every guide link's anchor here.
  it('every #anchor linked from a guide page exists', () => {
    const guide = join(import.meta.dirname, '..', 'guide');
    const pages = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? pages(join(dir, entry.name))
          : entry.name.endsWith('.md')
            ? [join(dir, entry.name)]
            : [],
      );
    const broken = pages(guide).flatMap((file) => {
      const from = posix.join('/guide', posix.relative(guide, dirname(file)).split('\\').join('/'));
      return [...readFileSync(file, 'utf8').matchAll(/\]\(([^)\s]*)#([^)\s]+)\)/g)].flatMap(
        ([, path = '', anchor = '']) => {
          if (/^[a-z]+:/.test(path)) return [];
          const route =
            path === ''
              ? posix.join(from, posix.basename(file, '.md'))
              : path.startsWith('/')
                ? path
                : posix.join(from, path);
          const html = join(dist, route.endsWith('/') ? `${route}index.html` : `${route}.html`);
          const ok = existsSync(html) && readFileSync(html, 'utf8').includes(`id="${anchor}"`);
          return ok ? [] : [`${posix.relative(guide, file)} → ${path}#${anchor}`];
        },
      );
    });
    expect(broken).toEqual([]);
  });

  it('emits a 404 page', () => {
    expect(existsSync(join(dist, '404.html'))).toBe(true);
  });
});
