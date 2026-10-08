// Shared helper for gate verification scripts: run a command, stream output, return exit code.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const bin = (name) => resolve(repoRoot, 'node_modules', '.bin', name);

// eslint-disable-next-line no-control-regex -- matching terminal escape sequences is the point
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

export function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd ?? repoRoot,
    stdio: 'pipe',
    encoding: 'utf8',
    env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1', ...opts.env },
    timeout: opts.timeout ?? 15 * 60 * 1000,
  });
  // Strip ANSI escapes so EXPECT regexes and summaries see plain text.
  const out = ((res.stdout ?? '') + (res.stderr ?? '')).replace(ANSI, '');
  process.stdout.write(out.length > 20000 ? out.slice(-20000) : out);
  if (res.error) {
    process.stdout.write(`\n[spawn error] ${res.error.message}\n`);
    return { code: 1, out };
  }
  return { code: res.status ?? 1, out };
}

export function step(title, cmd, args, opts) {
  process.stdout.write(`\n=== ${title}: ${cmd} ${args.join(' ')}\n`);
  const { code, out } = run(cmd, args, opts);
  if (code !== 0) {
    process.stdout.write(`\n[FAIL] ${title} exited ${code}\n`);
    process.exit(1);
  }
  return out;
}
