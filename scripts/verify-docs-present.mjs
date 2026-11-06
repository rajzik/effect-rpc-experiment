// Gate oracle: each named doc exists and is longer than a stub.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './_run.mjs';
const files = process.argv.slice(2);
for (const f of files) {
  const p = resolve(repoRoot, f);
  if (!existsSync(p) || readFileSync(p, 'utf8').length < 600) {
    process.stdout.write(`missing or too short: ${f}\n`);
    process.exit(1);
  }
}
process.stdout.write(`DOCS OK ${files.join(' ')}\n`);
