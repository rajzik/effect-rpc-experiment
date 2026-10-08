// Negative control: a deliberate type error must make `vp check` fail, proving tsgo type-check runs.
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { bin, run, repoRoot } from './_run.mjs';

const file = resolve(repoRoot, 'packages/core/src/__negative_control__.ts');
mkdirSync(resolve(repoRoot, 'packages/core/src'), { recursive: true });
writeFileSync(file, 'export const shouldFail: number = "not a number";\n');
try {
  const { code, out } = run(bin('vp'), ['check', '--no-fmt']);
  if (code === 0) {
    process.stdout.write('\n[FAIL] vp check passed despite a type error\n');
    process.exit(1);
  }
  if (!/not assignable|TS2322|Type 'string'/i.test(out)) {
    process.stdout.write('\n[FAIL] vp check failed but not with a type error diagnostic\n');
    process.exit(1);
  }
} finally {
  rmSync(file, { force: true });
}
process.stdout.write('\nNEGATIVE CONTROL OK: type errors fail vp check\n');
