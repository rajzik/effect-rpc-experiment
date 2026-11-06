/**
 * A Vite plugin that runs the schema generator when the build starts and again whenever a
 * module of the project changes in dev, so `router.gen.ts` / `router.client.gen.ts` stay current.
 *
 * @since 0.1.0
 */
import path from 'node:path';
import { createGenerator } from './generate.js';
import type { GenerateResult, Generator } from './generate.js';

/**
 * Options of {@link effectTrpcCodegen}.
 *
 * @category models
 * @since 0.1.0
 */
export interface CodegenPluginOptions {
  /** The `tsconfig.json` of the routers (default: `tsconfig.json`, relative to the Vite root). */
  readonly project?: string | undefined;
  /** The router modules to generate for (relative to the Vite root). */
  readonly routers: ReadonlyArray<string>;
}

/**
 * The context Vite gives plugin hooks (the subset the plugin uses).
 *
 * @category models
 * @since 0.1.0
 */
export interface CodegenPluginContext {
  readonly error: (message: string) => never;
  readonly warn: (message: string) => void;
}

/**
 * The plugin object (structurally a Vite / Rollup plugin; no dependency on `vite`).
 *
 * @category models
 * @since 0.1.0
 */
export interface CodegenPlugin {
  readonly name: 'effect-trpc-codegen';
  readonly configResolved: (config: { readonly root: string; readonly command: string }) => void;
  readonly buildStart: (this: CodegenPluginContext) => void;
  readonly watchChange: (this: CodegenPluginContext, id: string) => void;
  /** Dev: Vite calls it when the server closes. */
  readonly buildEnd: () => void;
  /** Build: after the bundle is written. */
  readonly closeBundle: () => void;
}

/**
 * Creates the Vite plugin that keeps the generated schema modules of `routers` up to date.
 *
 * **When to use**
 *
 * In Vite-based apps (Vite, Vitest, TanStack Start, electron-vite) whose routers are written
 * without `.output` / `.error`. For other bundlers (Next.js with Turbopack or webpack), run
 * `effect-trpc-codegen --watch` next to the dev server instead.
 *
 * **Details**
 *
 * - `buildStart` generates once (a build fails on generator errors; dev only warns).
 * - In dev (`vite serve`) every change to a `.ts` module except generated ones regenerates; Vite
 *   then reloads the generated modules like any edited file.
 * - The checker process stops when the dev server closes (`buildEnd`) or the build ends
 *   (`closeBundle`).
 *
 * **Gotchas**
 *
 * - Generated modules are written to disk next to the router module: commit them, or ignore
 *   `*.gen.ts` and let the plugin create them.
 *
 * **Example** (vite.config.ts)
 *
 * ```ts
 * import { effectTrpcCodegen } from '@effect-trpc/codegen/vite';
 *
 * export default {
 *   plugins: [effectTrpcCodegen({ routers: ['src/rpc/router.ts'] })],
 * };
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const effectTrpcCodegen = (options: CodegenPluginOptions): CodegenPlugin => {
  let root = process.cwd();
  let serving = false;
  let generator: Generator | undefined;
  const stop = (): void => {
    generator?.close();
    generator = undefined;
  };
  const run = (ctx: CodegenPluginContext, failOnError: boolean): void => {
    generator ??= createGenerator({
      project: options.project ?? 'tsconfig.json',
      routers: options.routers,
      cwd: root,
    });
    const result: GenerateResult = generator.run();
    if (result.errors.length === 0) return;
    const message = `effect-trpc-codegen:\n${result.errors.join('\n')}`;
    if (failOnError) ctx.error(message);
    else ctx.warn(message);
  };
  return {
    name: 'effect-trpc-codegen',
    configResolved: (config) => {
      root = config.root;
      serving = config.command === 'serve';
    },
    buildStart() {
      run(this, !serving);
    },
    watchChange(id) {
      if (
        !/\.[cm]?tsx?$/.test(id) ||
        id.endsWith('.gen.ts') ||
        id.includes(`${path.sep}node_modules${path.sep}`)
      )
        return;
      run(this, false);
    },
    buildEnd: () => {
      if (serving) stop();
    },
    closeBundle: () => {
      if (!serving) stop();
    },
  };
};
