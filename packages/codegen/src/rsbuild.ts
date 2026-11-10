/**
 * The schema generator as a Rsbuild plugin (see `@rpc-effect/codegen/unplugin`).
 *
 * @since 0.1.0
 */
import { unplugin } from './unplugin.js';

/**
 * Creates the Rsbuild plugin that keeps `router.gen.ts` / `router.client.gen.ts` of `routers` up
 * to date.
 *
 * **When to use**
 *
 * In Rsbuild, for routers written with the `Procedure` builder without `.output` / `.error`.
 *
 * **Details**
 *
 * - It generates when the build starts; a build fails on generator errors. It runs as an Rspack plugin under Rsbuild.
 * - The generated modules are written next to each router module, only when they change.
 *
 * **Gotchas**
 *
 * - Paths are relative to `root` (default: the bundler root, else the working directory).
 *
 * **Example** (Rsbuild config)
 *
 * ```ts
 * // rsbuild.config.ts
 * import { effectTrpcCodegen } from '@rpc-effect/codegen/rsbuild';
 *
 * export default {
 *   plugins: [effectTrpcCodegen({ routers: ['src/router.ts'] })],
 * };
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const effectTrpcCodegen = unplugin.rsbuild;

export type { CodegenPluginOptions } from './unplugin.js';
