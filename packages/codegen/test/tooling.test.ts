// The command (`effect-trpc-codegen`), the warm generator used by `--watch`, and the Vite plugin.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { createGenerator, runCommand } from '../src/index.js';
import type { CommandIO } from '../src/index.js';
import { effectTrpcCodegen } from '../src/vite.js';
import type { CodegenPluginContext } from '../src/vite.js';
import { copyFixture, removeDir } from './helpers.js';

const dirs: Array<string> = [];
const fixture = (name: string): string => {
  const dir = copyFixture(name);
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir);
});

const io = (cwd: string): CommandIO & { readonly lines: Array<string> } => {
  const lines: Array<string> = [];
  return { cwd, lines, out: (t) => lines.push(`out: ${t}`), err: (t) => lines.push(`err: ${t}`) };
};

describe('runCommand', () => {
  it('writes, then --check passes; a stale module fails --check', () => {
    const dir = fixture('app');
    rmSync(path.join(dir, 'router.gen.ts'));
    const first = io(dir);
    expect(runCommand(['-p', 'tsconfig.json', 'router.ts'], first)).toBe(0);
    expect(first.lines).toContain('out: wrote router.gen.ts');
    expect(runCommand(['--check', '-p', 'tsconfig.json', 'router.ts'], io(dir))).toBe(0);
    writeFileSync(path.join(dir, 'router.client.gen.ts'), '// stale\n');
    const stale = io(dir);
    expect(runCommand(['--check', '-p', 'tsconfig.json', 'router.ts'], stale)).toBe(1);
    expect(stale.lines).toContain('err: out of date: router.client.gen.ts');
    expect(readFileSync(path.join(dir, 'router.client.gen.ts'), 'utf8')).toBe('// stale\n'); // --check writes nothing
  });

  it('exits 1 with the errors of an unmappable router, 2 without arguments', () => {
    const dir = fixture('bad');
    const out = io(dir);
    expect(runCommand(['router.ts'], out)).toBe(1);
    expect(out.lines.some((l) => l.startsWith('err: error: router.ts:'))).toBe(true);
    expect(runCommand([], io(dir))).toBe(2);
    const help = io(dir);
    expect(runCommand(['--help'], help)).toBe(0);
    expect(help.lines[0]).toMatch(/^out: Usage: effect-trpc-codegen/);
  });
});

describe('createGenerator (watch mode)', () => {
  it('sees edits between runs', () => {
    const dir = fixture('app');
    const generator = createGenerator({
      project: 'tsconfig.json',
      routers: ['router.ts'],
      cwd: dir,
    });
    try {
      expect(generator.run().errors).toEqual([]);
      const router = path.join(dir, 'router.ts');
      writeFileSync(
        router,
        readFileSync(router, 'utf8').replace("Effect.succeed('ok' as const)", 'Effect.succeed(42)'),
      );
      const second = generator.run();
      expect(second.errors).toEqual([]);
      expect(second.files.find((f) => f.path.endsWith('router.gen.ts'))?.changed).toBe(true);
      expect(readFileSync(path.join(dir, 'router.gen.ts'), 'utf8')).toContain(
        'health: { output: __Schema.Number }',
      );
    } finally {
      generator.close();
    }
  });
});

const context = (): CodegenPluginContext & { readonly warnings: Array<string> } => {
  const warnings: Array<string> = [];
  return {
    warnings,
    warn: (message) => warnings.push(message),
    error: (message) => {
      throw new Error(message);
    },
  };
};

describe('effectTrpcCodegen (Vite plugin)', () => {
  it('generates on buildStart and regenerates on watchChange in dev', () => {
    const dir = fixture('app');
    rmSync(path.join(dir, 'router.gen.ts'));
    const plugin = effectTrpcCodegen({ routers: ['router.ts'] });
    plugin.configResolved({ root: dir, command: 'serve' });
    const ctx = context();
    plugin.buildStart.call(ctx);
    expect(existsSync(path.join(dir, 'router.gen.ts'))).toBe(true);
    const router = path.join(dir, 'router.ts');
    writeFileSync(
      router,
      readFileSync(router, 'utf8').replace("Effect.succeed('ok' as const)", 'Effect.succeed(true)'),
    );
    plugin.watchChange.call(ctx, path.join(dir, 'router.gen.ts')); // generated: ignored
    expect(readFileSync(path.join(dir, 'router.gen.ts'), 'utf8')).toContain(
      '__Schema.Literal("ok")',
    );
    plugin.watchChange.call(ctx, router);
    expect(readFileSync(path.join(dir, 'router.gen.ts'), 'utf8')).toContain(
      'health: { output: __Schema.Boolean }',
    );
    expect(ctx.warnings).toEqual([]);
    plugin.closeBundle(); // dev: keeps the checker for the next change
    plugin.watchChange.call(ctx, router);
    plugin.buildEnd(); // the dev server closed: the checker stops
  });

  it('fails a build on generator errors, only warns in dev', () => {
    const dir = fixture('bad');
    const build = effectTrpcCodegen({ routers: ['router.ts'] });
    build.configResolved({ root: dir, command: 'build' });
    expect(() => build.buildStart.call(context())).toThrow(
      /effect-trpc-codegen:\n.*router\.ts:\d+/,
    );
    build.closeBundle();
    const dev = effectTrpcCodegen({ routers: ['router.ts'] });
    dev.configResolved({ root: dir, command: 'serve' });
    const ctx = context();
    dev.buildStart.call(ctx);
    expect(ctx.warnings[0]).toMatch(/router\.ts:\d+/);
    dev.buildEnd();
  });
});
