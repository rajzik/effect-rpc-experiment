// Full repository verification, in the same order as CI.
import { step } from './_run.mjs';

step('ready (repo)', 'pnpm', ['run', 'ready']);
process.stdout.write('\nTOOLCHAIN VERIFIED\n');
