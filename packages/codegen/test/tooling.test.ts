// The command (`effect-trpc-codegen`), the warm generator used by `--watch`, and the Vite plugin.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createGenerator, runCommand } from '../src/index.js';
import type { CommandIO } from '../src/index.js';
import type { UnpluginBuildContext, UnpluginContextMeta } from 'unplugin';
import { effectTrpcCodegenLoader } from '../src/loader.js';
import { codegenUnpluginFactory, unplugin } from '../src/unplugin.js';
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

type Hooks = ReturnType<typeof codegenUnpluginFactory>;

const buildContext = (native?: {
  readonly framework: 'webpack';
  readonly compiler: { readonly watchMode: boolean };
}): UnpluginBuildContext & { readonly watched: Array<string> } => {
  const watched: Array<string> = [];
  return {
    watched,
    addWatchFile: (id) => watched.push(id),
    emitFile: () => undefined,
    getWatchFiles: () => watched,
    parse: () => undefined,
    getNativeBuildContext: native === undefined ? undefined : () => native,
  };
};

const hooks = (dir: string, framework: 'vite' | 'webpack' | 'rollup' | 'farm'): Hooks =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the factory reads only `framework`; the other meta fields are bundler-specific
  codegenUnpluginFactory({ routers: ['router.ts'], root: dir }, {
    framework,
  } as UnpluginContextMeta);

const call = (
  hook: unknown,
  ctx: UnpluginBuildContext,
  ...args: ReadonlyArray<unknown>
): unknown => {
  if (typeof hook !== 'function') throw new Error('missing hook');
  return Reflect.apply(hook, ctx, args);
};

describe('codegenUnpluginFactory (the hooks behind every bundler entry)', () => {
  it('buildStart generates and watches the project sources', () => {
    const dir = fixture('app');
    rmSync(path.join(dir, 'router.gen.ts'));
    const plugin = hooks(dir, 'rollup');
    const ctx = buildContext();
    call(plugin.buildStart, ctx);
    expect(existsSync(path.join(dir, 'router.gen.ts'))).toBe(true);
    expect(ctx.watched).toContain(path.join(dir, 'models.ts'));
    expect(ctx.watched.some((f) => f.endsWith('.gen.ts'))).toBe(false);
    call(plugin.buildEnd, ctx); // a one-off build: the checker stops
  });

  it('fails the build on generator errors', () => {
    const dir = fixture('bad');
    const plugin = hooks(dir, 'webpack');
    expect(() => call(plugin.buildStart, buildContext())).toThrow(
      /effect-trpc-codegen:\n.*router\.ts:\d+/,
    );
    call(plugin.buildEnd, buildContext());
  });

  it('only warns in Vite dev, and regenerates on watchChange there', () => {
    const dir = fixture('app');
    const plugin = hooks(dir, 'vite');
    const vite = plugin.vite;
    if (vite === undefined) throw new Error('missing vite hooks');
    call(vite.configResolved, buildContext(), {
      root: dir,
      command: 'serve',
      build: { watch: null },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      call(plugin.buildStart, buildContext());
      const router = path.join(dir, 'router.ts');
      writeFileSync(
        router,
        readFileSync(router, 'utf8').replace(
          "Effect.succeed('ok' as const)",
          'Effect.succeed(true)',
        ),
      );
      call(plugin.watchChange, buildContext(), path.join(dir, 'router.gen.ts'), {
        event: 'update',
      }); // generated: ignored
      expect(readFileSync(path.join(dir, 'router.gen.ts'), 'utf8')).toContain(
        '__Schema.Literal("ok")',
      );
      call(plugin.watchChange, buildContext(), router, { event: 'update' });
      expect(readFileSync(path.join(dir, 'router.gen.ts'), 'utf8')).toContain(
        'health: { output: __Schema.Boolean }',
      );
      // A broken edit: a warning, the dev server keeps running.
      writeFileSync(
        router,
        readFileSync(router, 'utf8').replace('Effect.succeed(true)', 'Effect.succeed(() => 1)'),
      );
      call(plugin.watchChange, buildContext(), router, { event: 'update' });
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/a function .* cannot be sent/));
      call(plugin.buildEnd, buildContext()); // dev: keeps the checker until the process exits
    } finally {
      warn.mockRestore();
    }
  });

  it('watchChange is left to buildStart outside Vite and Farm (webpack rebuilds call buildStart)', () => {
    const dir = fixture('app');
    const plugin = hooks(dir, 'webpack');
    const ctx = buildContext({ framework: 'webpack', compiler: { watchMode: true } });
    call(plugin.buildStart, ctx);
    const router = path.join(dir, 'router.ts');
    writeFileSync(
      router,
      readFileSync(router, 'utf8').replace("Effect.succeed('ok' as const)", 'Effect.succeed(7n)'),
    );
    call(plugin.watchChange, ctx, router, { event: 'update' });
    expect(readFileSync(path.join(dir, 'router.gen.ts'), 'utf8')).toContain(
      '__Schema.Literal("ok")',
    );
    call(plugin.buildEnd, ctx); // watching: the checker stays warm for the rebuild
    call(plugin.buildStart, ctx);
    expect(readFileSync(path.join(dir, 'router.gen.ts'), 'utf8')).toContain(
      'health: { output: __Schema.BigInt }',
    );
  });

  it('the bundler entries are unplugin targets', () => {
    expect(typeof unplugin.vite).toBe('function');
    expect(typeof unplugin.webpack).toBe('function');
    expect(unplugin.esbuild({ routers: [] }).name).toBe('effect-trpc-codegen');
  });
});

describe('effectTrpcCodegenLoader (Turbopack / webpack loader)', () => {
  it('regenerates, declares the project sources as dependencies and returns the module unchanged', () => {
    const dir = fixture('app');
    rmSync(path.join(dir, 'router.client.gen.ts'));
    const dependencies: Array<string> = [];
    const out = effectTrpcCodegenLoader.call(
      {
        rootContext: dir,
        resourcePath: path.join(dir, 'router.ts'),
        getOptions: () => ({}),
        addDependency: (file) => dependencies.push(file),
      },
      'export {};',
    );
    expect(out).toBe('export {};');
    expect(existsSync(path.join(dir, 'router.client.gen.ts'))).toBe(true);
    expect(dependencies).toContain(path.join(dir, 'models.ts'));
  });

  it('throws the generator errors', () => {
    const dir = fixture('bad');
    expect(() =>
      effectTrpcCodegenLoader.call(
        { rootContext: dir, getOptions: () => ({ routers: ['router.ts'] }) },
        '',
      ),
    ).toThrow(/router\.ts:\d+/);
  });
});
