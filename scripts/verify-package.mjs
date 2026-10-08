// Gate oracle for a package leaf: lint+format+typecheck of the whole repo, then that package's
// runtime + type tests and its build. Usage: node scripts/verify-package.mjs <name> [minTests]
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { bin, step, repoRoot } from './_run.mjs';

const args = process.argv.slice(2);
const skipReadme = args.includes('--skip-readme');
const [name, minTestsArg] = args.filter((a) => !a.startsWith('--'));
if (!name) {
  process.stdout.write('usage: verify-package.mjs <package> [minTests]\n');
  process.exit(2);
}
const minTests = Number(minTestsArg ?? '1');
const pkgDir = resolve(repoRoot, 'packages', name);
if (!existsSync(resolve(pkgDir, 'package.json'))) {
  process.stdout.write(`no such package: ${name}\n`);
  process.exit(2);
}
step('vp check (repo)', bin('vp'), ['check']);
step(`tsgo build (repo)`, bin('vp'), ['run', 'typecheck']);
const testOut = step(`vitest ${name}`, bin('vp'), ['-C', `packages/${name}`, 'test']);
const m = /Tests\s+(\d+) passed/.exec(testOut);
const passed = m ? Number(m[1]) : 0;
if (passed < minTests) {
  process.stdout.write(`\n[FAIL] expected at least ${minTests} passing tests, saw ${passed}\n`);
  process.exit(1);
}
if (/Type Errors\s+(?!no errors)\S/.test(testOut) || /\b\d+ failed\b/.test(testOut)) {
  process.stdout.write('\n[FAIL] vitest reported failures or type errors\n');
  process.exit(1);
}
step(`pack ${name}`, bin('vp'), ['-C', `packages/${name}`, 'pack']);
const readme = resolve(pkgDir, 'README.md');
if (!skipReadme && (!existsSync(readme) || readFileSync(readme, 'utf8').length < 400)) {
  process.stdout.write('\n[FAIL] README.md missing or too short (< 400 chars)\n');
  process.exit(1);
}
process.stdout.write(`\nPACKAGE ${name} VERIFIED (${passed} tests)\n`);
