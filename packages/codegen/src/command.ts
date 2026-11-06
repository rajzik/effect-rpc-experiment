/**
 * The `effect-trpc-codegen` command: generates the schema modules of routers written without
 * `.output` / `.error`, once (`--check` to verify they are up to date) or on every change
 * (`--watch`).
 *
 * @since 0.1.0
 */
import { watch } from 'node:fs';
import path from 'node:path';
import { createGenerator } from './generate.js';
import type { GenerateResult } from './generate.js';

const USAGE = `Usage: effect-trpc-codegen [--project tsconfig.json] [--watch | --check] <router.ts>...

Writes <router>.gen.ts (serve it) and <router>.client.gen.ts (give it to clients) next to each
router module, with the schemas inferred from its handlers.

  --project <file>  the tsconfig.json of the routers (default: tsconfig.json)
  --watch           regenerate on every change to a .ts file of the project directory
  --check           do not write: exit 1 when a generated module is missing or out of date`;

/**
 * Where the command writes (defaults to the process streams).
 *
 * @category models
 * @since 0.1.0
 */
export interface CommandIO {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly cwd: string;
}

const processIO: CommandIO = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
  cwd: process.cwd(),
};

const report = (io: CommandIO, result: GenerateResult, check: boolean): boolean => {
  for (const error of result.errors) io.err(`error: ${error}`);
  for (const file of result.files) {
    const rel = path.relative(io.cwd, file.path);
    if (check) {
      if (file.changed) io.err(`out of date: ${rel}`);
    } else if (file.changed) io.out(`wrote ${rel}`);
  }
  return result.errors.length === 0 && (!check || result.files.every((f) => !f.changed));
};

/**
 * Runs `effect-trpc-codegen` with `argv` (the arguments after the command name) and returns the
 * exit code; in `--watch` mode it returns `0` and keeps watching.
 *
 * **When to use**
 *
 * The `effect-trpc-codegen` binary calls it. Call it yourself to embed the command (a custom
 * script, a test).
 *
 * **Details**
 *
 * - `effect-trpc-codegen [--project tsconfig.json] <router.ts>...` writes `<router>.gen.ts` and
 *   `<router>.client.gen.ts` next to each router module; exit code `1` on generator errors.
 * - `--check` writes nothing and exits `1` when a generated module is missing or out of date
 *   (for CI).
 * - `--watch` regenerates on every change to a `.ts` file under the project directory (generated
 *   modules and `node_modules` excluded): run it next to `next dev` or any dev server.
 *
 * **Gotchas**
 *
 * - Paths are relative to `io.cwd` (the process working directory by default).
 *
 * **Example** (A check in a script)
 *
 * ```ts
 * import { runCommand } from '@effect-trpc/codegen';
 *
 * const code = runCommand(['--check', 'src/router.ts']);
 * process.exitCode = code;
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const runCommand = (argv: ReadonlyArray<string>, io: CommandIO = processIO): number => {
  const print = io.out;
  let project = 'tsconfig.json';
  let mode: 'once' | 'watch' | 'check' = 'once';
  const routers: Array<string> = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project' || arg === '-p') project = argv[++i] ?? project;
    else if (arg === '--watch' || arg === '-w') mode = 'watch';
    else if (arg === '--check') mode = 'check';
    else if (arg === '--help' || arg === '-h') {
      print(USAGE);
      return 0;
    } else if (arg !== undefined) routers.push(arg);
  }
  if (routers.length === 0) {
    io.err(USAGE);
    return 2;
  }
  const generator = createGenerator({ project, routers, cwd: io.cwd, write: mode !== 'check' });
  const ok = report(io, generator.run(), mode === 'check');
  if (mode !== 'watch') {
    generator.close();
    return ok ? 0 : 1;
  }
  print('watching for changes…');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const root = path.dirname(path.resolve(io.cwd, project));
  watch(root, { recursive: true }, (_event, file) => {
    if (
      file === null ||
      !/\.[cm]?tsx?$/.test(file) ||
      file.endsWith('.gen.ts') ||
      file.includes('node_modules')
    )
      return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      report(io, generator.run(), false);
    }, 100);
  });
  return 0;
};
