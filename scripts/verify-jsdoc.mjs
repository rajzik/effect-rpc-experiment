#!/usr/bin/env node
// Enforces the Effect-style JSDoc contract described in docs/jsdoc-style.md and type-checks every
// `ts` / `tsx` example fence against the built packages.
//
//   node scripts/verify-jsdoc.mjs                 # all packages, structure + examples
//   node scripts/verify-jsdoc.mjs core server     # selected packages
//   node scripts/verify-jsdoc.mjs --no-examples   # structure only (no build needed)
//   node scripts/verify-jsdoc.mjs --keep          # keep packages/*/.jsdoc-examples for debugging
//
// Examples are type-checked against `dist/*.d.mts`, so run `vp run -r build` first.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { bin, repoRoot, run } from './_run.mjs';
import {
  braceDelta,
  docAbove,
  docText,
  EXPORT_RE,
  examplesOf,
  VALUE_KINDS,
  walk,
} from './jsdoc-parse.mjs';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const selected = argv.filter((a) => !a.startsWith('--'));
const checkExamples = !flags.has('--no-examples');
const keep = flags.has('--keep');

const packagesDir = join(repoRoot, 'packages');
const packages = readdirSync(packagesDir)
  .filter((name) => existsSync(join(packagesDir, name, 'src')))
  .filter((name) => selected.length === 0 || selected.includes(name));

const problems = [];
const report = (file, line, msg) => problems.push(`${relative(repoRoot, file)}:${line}  ${msg}`);

const collected = new Map(); // pkg -> [{ name, lang, code }]

for (const pkg of packages) {
  const examples = [];
  collected.set(pkg, examples);
  for (const file of walk(join(packagesDir, pkg, 'src'))) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    const isBarrel = basename(file).startsWith('index.');

    // 1. Module header: the file must open with a /** ... @since ... */ block.
    const first = lines.findIndex((l) => l.trim() !== '');
    if (!lines[first]?.trim().startsWith('/**')) {
      report(
        file,
        1,
        'missing module header JSDoc (/** <overview> @since x.y.z */ as the first token)',
      );
    } else {
      let end = first;
      while (end < lines.length && !lines[end].includes('*/')) end++;
      const header = docText(lines.slice(first, end + 1));
      if (!/@since\s+\d+\.\d+\.\d+/.test(header))
        report(file, first + 1, 'module header lacks @since');
      if (header.replace(/@\w+[^\n]*/g, '').trim().length < 40)
        report(
          file,
          first + 1,
          'module header needs an overview paragraph (what the module is for)',
        );
    }
    if (isBarrel) continue;

    // 2. Every export carries a doc block with description, @since, @category (top level) and,
    //    for top-level values, at least one **Example** fence.
    let depth = 0; // brace depth, to tell namespace members from top-level exports
    lines.forEach((line, i) => {
      const m = EXPORT_RE.exec(line);
      if (m) {
        const [, indent, rawKind, name] = m;
        const kind = rawKind.replace(/\s+/g, ' ');
        const topLevel = depth === 0 && indent.length === 0;
        const block = docAbove(lines, i);
        const where = `${kind} ${name}`;
        if (!block) {
          report(file, i + 1, `${where}: missing JSDoc`);
        } else {
          const text = docText(block);
          if (/@internal\b/.test(text)) {
            // internal exports only need the block itself
          } else {
            const description = text.split(/\n\s*@/)[0].trim();
            if (description.length < 10) report(file, i + 1, `${where}: JSDoc needs a description`);
            if (!/@since\s+\d+\.\d+\.\d+/.test(text))
              report(file, i + 1, `${where}: missing @since`);
            if (topLevel && !/@category\s+\S/.test(text))
              report(file, i + 1, `${where}: missing @category`);
            const exs = examplesOf(text);
            if (topLevel && VALUE_KINDS.has(kind)) {
              if (!/\*\*Example\*\*/.test(text) || exs.length === 0)
                report(file, i + 1, `${where}: value exports need an **Example** with a ts fence`);
            }
            exs.forEach((ex, n) => {
              if (/\bnocheck\b/.test(ex.info)) return;
              const stem = `${relative(join(packagesDir, pkg, 'src'), file).replace(/[\\/.]/g, '_')}__${name}_L${i + 1}__${n}`;
              examples.push({
                stem,
                lang: ex.lang,
                code: ex.code,
                origin: `${relative(repoRoot, file)}:${i + 1} ${name}`,
              });
            });
          }
        }
      }
      // Track brace depth outside strings/comments well enough for declaration files.
      depth = Math.max(0, depth + braceDelta(line));
    });
  }
}

// 3. Type-check examples per package (self-imports resolve through package.json "exports").
let exampleCount = 0;
if (checkExamples) {
  for (const [pkg, examples] of collected) {
    if (examples.length === 0) continue;
    const dir = join(packagesDir, pkg, '.jsdoc-examples');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const origins = new Map();
    for (const ex of examples) {
      const fileName = `${ex.stem}.${ex.lang}`;
      origins.set(fileName, ex.origin);
      writeFileSync(join(dir, fileName), ex.code);
    }
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify(
        {
          extends: '../../../tsconfig.base.json',
          compilerOptions: {
            composite: false,
            declaration: false,
            declarationMap: false,
            sourceMap: false,
            noEmit: true,
            noUnusedLocals: false,
            noUnusedParameters: false,
            plugins: [],
          },
          include: ['*.ts', '*.tsx'],
        },
        null,
        2,
      ),
    );
    exampleCount += examples.length;
    process.stdout.write(`\n=== ${pkg}: type-checking ${examples.length} JSDoc examples\n`);
    const { code, out } = run(
      bin('tsgo'),
      ['-p', join(dir, 'tsconfig.json'), '--pretty', 'false'],
      {
        cwd: dir,
      },
    );
    if (code !== 0) {
      for (const errLine of out.split('\n').filter((l) => /error TS\d+/.test(l))) {
        const f = errLine.split('(')[0].trim();
        problems.push(
          `[example] ${origins.get(basename(f)) ?? f}: ${errLine.slice(errLine.indexOf('error'))}`,
        );
      }
      if (!problems.some((p) => p.startsWith('[example]')))
        problems.push(`[example] ${pkg}: tsgo exited ${code}`);
    }
    if (!keep) rmSync(dir, { recursive: true, force: true });
  }
}

if (problems.length > 0) {
  process.stdout.write(
    `\n${problems.join('\n')}\n\n[FAIL] verify-jsdoc: ${problems.length} problem(s)\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `\n[OK] verify-jsdoc: ${packages.length} package(s), ${checkExamples ? `${exampleCount} examples type-checked` : 'examples skipped'}\n`,
);
