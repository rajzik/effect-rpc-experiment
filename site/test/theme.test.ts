// The theme recreates effect.website's look with our own tokens and ships no Effect brand assets.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

const site = join(import.meta.dirname, '..');
const tokens = () => readFileSync(join(site, '.vitepress', 'theme', 'tokens.css'), 'utf8');

const block = (css: string, selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  return start === -1 ? '' : css.slice(start, css.indexOf('}', start));
};

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'cache', 'dist'].includes(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [relative(site, path)];
  });

describe('theme', () => {
  it.each([':root', '.dark'])('defines %s tokens', (selector) => {
    const css = block(tokens(), selector);
    for (const name of ['--vp-c-bg', '--vp-c-text-1', '--vp-c-brand-1', '--vp-c-divider']) {
      expect(css).toContain(`${name}:`);
    }
  });

  it('uses the effect palette', () => {
    const css = tokens().toLowerCase();
    for (const color of ['#09090b', '#18181b', '#10b981']) expect(css).toContain(color);
  });

  it('ships no Effect brand assets', () => {
    expect(files(site).filter((file) => /effect-logo|logomark/i.test(file))).toEqual([]);
  });
});
