/**
 * The schema generator as an [unplugin](https://unplugin.unjs.io): one plugin for Vite, Rollup,
 * Rolldown, webpack, Rspack, Rsbuild, esbuild, Farm and Bun that keeps `router.gen.ts` and
 * `router.client.gen.ts` up to date while the bundler builds or watches.
 *
 * @since 0.1.0
 */
import path from 'node:path';
import { createUnplugin } from 'unplugin';
import type { UnpluginBuildContext, UnpluginFactory, UnpluginInstance } from 'unplugin';
import { createGenerator } from './generate.js';
import type { GenerateResult, Generator } from './generate.js';

/**
 * Options of the codegen bundler plugins (every `@rpc-effect/codegen/<bundler>` entry and the
 * `/loader`).
 *
 * @category models
 * @since 0.1.0
 */
export interface CodegenPluginOptions {
  /** The router modules to generate for (relative to `root`). */
  readonly routers: ReadonlyArray<string>;
  /** The `tsconfig.json` of the routers (default: `tsconfig.json`, relative to `root`). */
  readonly project?: string | undefined;
  /**
   * Base directory for `routers` and `project` (default: the bundler's root: Vite `root`, esbuild
   * `absWorkingDir`, webpack / Rspack `context`; else `process.cwd()`).
   */
  readonly root?: string | undefined;
}

const NAME = 'effect-trpc-codegen';

/** Whether a changed file can affect the generated modules. */
const isSource = (id: string): boolean =>
  /\.[cm]?tsx?$/.test(id) &&
  !id.endsWith('.gen.ts') &&
  !id.includes(`${path.sep}node_modules${path.sep}`);

const message = (result: GenerateResult): string => `${NAME}:\n${result.errors.join('\n')}`;

/** Fails the build with the generator errors, or only warns (Vite dev, watch changes). */
const report = (result: GenerateResult, fail: boolean): void => {
  if (result.errors.length === 0) return;
  if (fail) throw new Error(message(result));
  console.warn(message(result));
};

/** Reads `meta.watchMode` of a Rollup / Rolldown plugin context (and `compiler.watchMode` of webpack). */
const isWatching = (ctx: UnpluginBuildContext): boolean => {
  const native = ctx.getNativeBuildContext?.();
  if (native !== undefined && (native.framework === 'webpack' || native.framework === 'rspack'))
    return Reflect.get(native.compiler, 'watchMode') === true;
  const meta: unknown = Reflect.get(ctx, 'meta');
  return typeof meta === 'object' && meta !== null && Reflect.get(meta, 'watchMode') === true;
};

/**
 * The plugin factory behind every bundler entry (`unplugin.raw`).
 *
 * **When to use**
 *
 * To build a plugin for a bundler unplugin supports but this package has no entry for, or to
 * test the hooks. Otherwise import the entry of your bundler (`@rpc-effect/codegen/vite`, …).
 *
 * **Details**
 *
 * - `buildStart` generates (every bundler calls it at the start of a build; webpack, Rspack and
 *   esbuild call it on every rebuild too). It adds the project's source files as watch files, so
 *   editing a model module regenerates as well.
 * - `watchChange` regenerates in Vite dev and Farm, whose `buildStart` runs once per server.
 * - Generator errors fail the build (throw), except in Vite dev, where they are warnings and the
 *   next change retries. Generated modules are written only when their content changes, so a
 *   rebuild triggered by a write finds nothing to do.
 * - The TypeScript checker stays warm while the bundler watches and stops when a one-off build
 *   ends (and at process exit).
 *
 * **Gotchas**
 *
 * - Turbopack does not run unplugins: use `@rpc-effect/codegen/loader` (or
 *   `effect-trpc-codegen --watch`) there.
 *
 * **Example** (A plugin for another unplugin target)
 *
 * ```ts
 * import { createUnplugin } from 'unplugin';
 * import { codegenUnpluginFactory } from '@rpc-effect/codegen/unplugin';
 *
 * const plugin = createUnplugin(codegenUnpluginFactory).unloader({ routers: ['src/router.ts'] });
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const codegenUnpluginFactory: UnpluginFactory<CodegenPluginOptions, false> = (
  options,
  meta,
) => {
  let root = options.root;
  let viteServe = false;
  let watching = false;
  let generator: Generator | undefined;
  const stop = (): void => {
    generator?.close();
    generator = undefined;
  };
  const run = (): GenerateResult => {
    if (generator === undefined) {
      generator = createGenerator({
        project: options.project ?? 'tsconfig.json',
        routers: options.routers,
        cwd: root ?? process.cwd(),
      });
      process.once('exit', stop);
    }
    return generator.run();
  };
  return {
    name: NAME,
    // Generated modules must exist before other plugins resolve imports of them.
    enforce: 'pre',
    buildStart() {
      watching ||= viteServe || isWatching(this);
      const result = run();
      // esbuild watches its module graph and supports `addWatchFile` only in resolve/load hooks.
      if (meta.framework !== 'esbuild') for (const file of result.inputs) this.addWatchFile(file);
      report(result, !viteServe);
    },
    watchChange(id) {
      if ((meta.framework !== 'vite' && meta.framework !== 'farm') || !isSource(id)) return;
      report(run(), false);
    },
    buildEnd() {
      if (!watching) stop();
    },
    // The bundler's root, unless `root` is given.
    esbuild: {
      config(buildOptions) {
        root = options.root ?? buildOptions.absWorkingDir ?? root;
      },
    },
    webpack(compiler) {
      root = options.root ?? compiler.context;
    },
    rspack(compiler) {
      root = options.root ?? compiler.context;
    },
    vite: {
      configResolved(config) {
        root = options.root ?? config.root;
        viteServe = config.command === 'serve';
        watching = viteServe || Boolean(config.build.watch);
      },
    },
  };
};

/**
 * The codegen unplugin instance: `unplugin.vite(options)`, `unplugin.webpack(options)`, ….
 *
 * **When to use**
 *
 * When one config builds plugins for several bundlers. Otherwise import the entry of your bundler
 * (`@rpc-effect/codegen/vite`, `/rollup`, `/rolldown`, `/webpack`, `/rspack`, `/rsbuild`,
 * `/esbuild`, `/farm`, `/bun`).
 *
 * **Details**
 *
 * - Every target runs {@link codegenUnpluginFactory}; see it for when generation happens and how
 *   errors are reported.
 *
 * **Gotchas**
 *
 * - The bundler itself is a peer dependency of unplugin: install the one you use.
 *
 * **Example** (Plugins for two bundlers)
 *
 * ```ts
 * import { unplugin } from '@rpc-effect/codegen/unplugin';
 *
 * const options = { routers: ['src/router.ts'] };
 * export const vitePlugin = unplugin.vite(options);
 * export const esbuildPlugin = unplugin.esbuild(options);
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const unplugin: UnpluginInstance<CodegenPluginOptions, false> =
  createUnplugin(codegenUnpluginFactory);
