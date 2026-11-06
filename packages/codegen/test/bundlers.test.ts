// Real bundlers with the codegen plugin: the generated modules are written before the bundler
// resolves them, the client bundle has no handler code, and generator errors fail the build.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build as esbuild } from 'esbuild';
import { rollup } from 'rollup';
import { build as viteBuild, createServer } from 'vite-plus';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { effectTrpcCodegen as esbuildPlugin } from '../src/esbuild.js';
import { effectTrpcCodegen as rollupPlugin } from '../src/rollup.js';
import { effectTrpcCodegen as vitePlugin } from '../src/vite.js';
import { copyFixture, removeDir } from './helpers.js';

const dirs: Array<string> = [];
const fresh = (name: string): string => {
  const dir = copyFixture(name);
  dirs.push(dir);
  for (const file of ['router.gen.ts', 'router.client.gen.ts'])
    rmSync(path.join(dir, file), { force: true });
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir);
});

/** No handler code or server-only module in a client bundle. */
const expectClientOnly = (code: string): void => {
  expect(code).toContain('PostNotFound');
  expect(code).not.toContain('server-only');
  expect(code).not.toContain('Typed errors'); // a post title from the server-only db module
};

describe('esbuild', () => {
  it('generates before resolving and bundles only the client contract', async () => {
    const dir = fresh('app');
    const result = await esbuild({
      absWorkingDir: dir,
      entryPoints: ['main.ts'],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'neutral',
      packages: 'external',
      logLevel: 'silent',
      plugins: [esbuildPlugin({ routers: ['router.ts'] })],
    });
    expect(existsSync(path.join(dir, 'router.gen.ts'))).toBe(true);
    expectClientOnly(result.outputFiles.map((f) => f.text).join('\n'));
  });

  it('fails the build on generator errors', async () => {
    const dir = fresh('bad');
    writeFileSync(path.join(dir, 'main.ts'), 'export {};\n');
    await expect(
      esbuild({
        absWorkingDir: dir,
        entryPoints: ['main.ts'],
        write: false,
        logLevel: 'silent',
        plugins: [esbuildPlugin({ routers: ['router.ts'] })],
      }),
    ).rejects.toThrow(/router\.ts:\d+/);
  });
});

describe('Rollup', () => {
  it('generates in buildStart and fails the build on generator errors', async () => {
    const dir = fresh('app');
    writeFileSync(path.join(dir, 'entry.js'), 'export const ok = 1;\n');
    const bundle = await rollup({
      input: path.join(dir, 'entry.js'),
      plugins: [rollupPlugin({ routers: ['router.ts'], root: dir })],
    });
    await bundle.close();
    expect(readFileSync(path.join(dir, 'router.client.gen.ts'), 'utf8')).toContain(
      '__Router.make(',
    );
    const bad = fresh('bad');
    writeFileSync(path.join(bad, 'entry.js'), 'export const ok = 1;\n');
    await expect(
      rollup({
        input: path.join(bad, 'entry.js'),
        plugins: [rollupPlugin({ routers: ['router.ts'], root: bad })],
        onwarn: () => undefined,
      }),
    ).rejects.toThrow(/router\.ts:\d+/);
  });
});

describe('Vite', () => {
  it('vite build: generates, then bundles only the client contract', async () => {
    const dir = fresh('app');
    await viteBuild({
      root: dir,
      configFile: false,
      logLevel: 'silent',
      plugins: [vitePlugin({ routers: ['router.ts'] })],
      build: {
        outDir: path.join(dir, 'dist'),
        lib: { entry: path.join(dir, 'main.ts'), formats: ['es'], fileName: 'main' },
        rollupOptions: { external: [/^effect/, /^@effect-trpc\//] },
        minify: false,
      },
    });
    const out = readdirSync(path.join(dir, 'dist')).map((f) =>
      readFileSync(path.join(dir, 'dist', f), 'utf8'),
    );
    expect(existsSync(path.join(dir, 'router.client.gen.ts'))).toBe(true);
    expectClientOnly(out.join('\n'));
  });

  it('vite dev: regenerates when the router module changes', async () => {
    const dir = fresh('app');
    const server = await createServer({
      root: dir,
      configFile: false,
      logLevel: 'silent',
      plugins: [vitePlugin({ routers: ['router.ts'] })],
    });
    try {
      await new Promise((resolve) => server.watcher.once('ready', resolve));
      await server.pluginContainer.buildStart({});
      const gen = path.join(dir, 'router.gen.ts');
      expect(readFileSync(gen, 'utf8')).toContain('__Schema.Literal("ok")');
      const router = path.join(dir, 'router.ts');
      writeFileSync(
        router,
        readFileSync(router, 'utf8').replace("Effect.succeed('ok' as const)", 'Effect.succeed(1)'),
      );
      await expect
        .poll(() => readFileSync(gen, 'utf8'), { timeout: 10_000, interval: 100 })
        .toContain('health: { output: __Schema.Number }');
    } finally {
      await server.close();
    }
  });
});
