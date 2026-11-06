// Gate oracle (root R3): docs/trpc-test-parity.md must classify every file listed in
// docs/trpc-test-inventory.txt as `ported` (with existing local test paths), `not-applicable`
// (with a reason) or `deferred` (with a reason).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './_run.mjs';

const inventory = readFileSync(resolve(repoRoot, 'docs/trpc-test-inventory.txt'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  // Inventory lines are repo-relative to trpc/trpc (packages/...); table rows omit the prefix.
  .map((l) => l.replace(/^packages\//, ''));
const tablePath = resolve(repoRoot, 'docs/trpc-test-parity.md');
if (!existsSync(tablePath)) {
  process.stdout.write('docs/trpc-test-parity.md is missing\n');
  process.exit(1);
}
const rows = new Map();
for (const line of readFileSync(tablePath, 'utf8').split('\n')) {
  const m =
    /^\|\s*`?([^|`]+?)`?\s*\|\s*(ported|not-applicable|deferred)\s*\|\s*(.*?)\s*\|\s*$/.exec(line);
  if (m) rows.set(m[1].trim(), { status: m[2], detail: m[3] });
}
const problems = [];
let ported = 0;
let notApplicable = 0;
let deferred = 0;
for (const file of inventory) {
  const row = rows.get(file);
  if (!row) {
    problems.push(`missing row: ${file}`);
    continue;
  }
  if (row.detail.replaceAll(/[`\s]/g, '').length < 8)
    problems.push(`row has no reason/target: ${file}`);
  if (/UNCLASSIFIED/.test(row.detail)) problems.push(`row still unclassified: ${file}`);
  if (row.status === 'ported') {
    ported++;
    const targets = [...row.detail.matchAll(/`([^`]+\.test(?:-d)?\.tsx?)`/g)].map((x) => x[1]);
    if (targets.length === 0)
      problems.push(`ported row without a \`path.test.ts\` target: ${file}`);
    for (const t of targets) {
      if (!existsSync(resolve(repoRoot, t)))
        problems.push(`ported target does not exist: ${t} (for ${file})`);
    }
  } else if (row.status === 'not-applicable') notApplicable++;
  else deferred++;
}
for (const file of rows.keys()) {
  if (!inventory.includes(file)) problems.push(`row for unknown tRPC file: ${file}`);
}
process.stdout.write(
  `inventory=${inventory.length} ported=${ported} not-applicable=${notApplicable} deferred=${deferred}\n`,
);
if (problems.length > 0) {
  process.stdout.write(problems.slice(0, 60).join('\n') + '\n');
  process.exit(1);
}
if (ported === 0) {
  process.stdout.write('no ported rows\n');
  process.exit(1);
}
process.stdout.write('PARITY TABLE COMPLETE\n');
