/**
 * The schema generator as a webpack plugin (see `@rpc-effect/codegen/unplugin`).
 *
 * @since 0.1.0
 */
import { unplugin } from './unplugin.js';

/**
 * Creates the webpack plugin that keeps `router.gen.ts` / `router.client.gen.ts` of `routers` up
 * to date.
 *
 * **When to use**
 *
 * In webpack 5 (also Next.js with `--webpack`: push it into `config.plugins` in `next.config`), for routers written with the `Procedure` builder without `.output` / `.error`.
 *
 * **Details**
 *
 * - It generates when the build starts; a build fails on generator errors. Every compilation (including watch rebuilds) regenerates first; the project's source files are added to the compilation's file dependencies.
 * - The generated modules are written next to each router module, only when they change.
 *
 * **Gotchas**
 *
 * - Paths are relative to `root` (default: the bundler root, else the working directory).
 *
 * **Example** (webpack config)
 *
 * ```ts
 * // webpack.config.mjs
 * import { effectTrpcCodegen } from '@rpc-effect/codegen/webpack';
 *
 * export default {
 *   entry: './src/main.ts',
 *   plugins: [effectTrpcCodegen({ routers: ['src/router.ts'] })],
 * };
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const effectTrpcCodegen = unplugin.webpack;

export type { CodegenPluginOptions } from './unplugin.js';
