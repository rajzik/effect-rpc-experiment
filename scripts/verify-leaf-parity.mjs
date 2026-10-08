// Gate oracle: packages/<name>/test/PARITY.md maps tRPC test files to local tests; every local test
// path it names must exist and the whole package suite must pass.
// Row format: `| <tRPC test file> | <local test file(s)> | <notes> |`. The tRPC path may be given
// with or without the leading `packages/`; the local column may list several backticked files.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bin, step, repoRoot } from './_run.mjs';

const [name] = process.argv.slice(2);
const parity = resolve(repoRoot, 'packages', name, 'test', 'PARITY.md');
if (!existsSync(parity)) {
  process.stdout.write(`missing ${parity}\n`);
  process.exit(1);
}
const norm = (p) =>
  p
    .trim()
    .replace(/^`|`$/g, '')
    .replace(/^packages\//, '');
const inventory = new Set(
  readFileSync(resolve(repoRoot, 'docs/trpc-test-inventory.txt'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map(norm),
);
const rows = [];
for (const line of readFileSync(parity, 'utf8').split('\n')) {
  const cells = line
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());
  if (cells.length < 2) continue;
  if (/^-+$/.test(cells[0]) || /^trpc test/i.test(cells[0])) continue;
  const ticked = [...cells[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const locals =
    ticked.length > 0
      ? ticked
      : cells[1]
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean);
  rows.push({ trpc: norm(cells[0]), locals });
}
if (rows.length < 3) {
  process.stdout.write(`PARITY.md has ${rows.length} mapping rows; expected >= 3\n`);
  process.exit(1);
}
const problems = [];
for (const { trpc, locals } of rows) {
  if (!inventory.has(trpc)) problems.push(`unknown tRPC test file: ${trpc}`);
  if (locals.length === 0) problems.push(`no local test listed for: ${trpc}`);
  for (const local of locals) {
    const target = resolve(repoRoot, 'packages', name, 'test', local);
    if (!existsSync(target)) problems.push(`local test does not exist: ${local} (for ${trpc})`);
  }
}
if (problems.length > 0) {
  process.stdout.write(problems.join('\n') + '\n');
  process.exit(1);
}
const out = step(`vitest ${name}`, bin('vp'), ['-C', `packages/${name}`, 'test']);
if (
  !/Tests\s+\d+ passed/.test(out) ||
  /\b\d+ failed\b/.test(out) ||
  /Type Errors\s+(?!no errors)\S/.test(out)
) {
  process.stdout.write('\n[FAIL] tests failed\n');
  process.exit(1);
}
process.stdout.write(`LEAF PARITY OK ${name}: ${rows.length} tRPC files mapped\n`);
