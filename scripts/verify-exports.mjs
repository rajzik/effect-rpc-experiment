// Gate oracle: the built package exposes every required public symbol.
// Usage: node scripts/verify-exports.mjs <package> <symbol> [<symbol> ...]
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { repoRoot } from './_run.mjs';

const [name, ...symbols] = process.argv.slice(2);
const entry = resolve(repoRoot, 'packages', name, 'dist', 'index.mjs');
if (!existsSync(entry)) {
  process.stdout.write(`missing build output: ${entry}\n`);
  process.exit(1);
}
const mod = await import(pathToFileURL(entry).href);
const missing = symbols.filter((s) => !(s in mod));
if (missing.length > 0) {
  process.stdout.write(`missing exports from @effect-trpc/${name}: ${missing.join(', ')}\n`);
  process.exit(1);
}
process.stdout.write(`EXPORTS OK ${name}: ${symbols.join(', ')}\n`);
