// Root gate R4: run the cross-package end-to-end suite in packages/e2e.
import { bin, step } from './_run.mjs';
const out = step('vitest e2e', bin('vp'), ['-C', 'packages/e2e', 'test']);
const m = /Tests\s+(\d+) passed/.exec(out);
if (!m || Number(m[1]) < 3) {
  process.stdout.write(`\n[FAIL] expected >= 3 passing e2e tests, saw ${m ? m[1] : 0}\n`);
  process.exit(1);
}
if (/Type Errors\s+(?!no errors)\S/.test(out) || /\b\d+ failed\b/.test(out)) {
  process.stdout.write('\n[FAIL] e2e reported failures or type errors\n');
  process.exit(1);
}
process.stdout.write('E2E VERIFIED\n');
