// Gate oracle for the toolchain leaf: fmt+lint+typecheck via Vite+, tsgo build, tests, pack.
import { bin, step } from './_run.mjs';

step('vp check', bin('vp'), ['check']);
step('tsgo build', bin('vp'), ['run', 'typecheck']);
step('vitest (all packages)', bin('vp'), ['run', '-r', 'test']);
step('pack (all packages)', bin('vp'), ['run', '-r', 'build']);
process.stdout.write('\nTOOLCHAIN VERIFIED\n');
