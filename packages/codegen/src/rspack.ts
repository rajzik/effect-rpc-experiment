/**
 * The schema generator as a Rspack plugin (see `@effect-trpc/codegen/unplugin`).
 *
 * @since 0.1.0
 */
import { unplugin } from './unplugin.js';

/**
 * Creates the Rspack plugin that keeps `router.gen.ts` / `router.client.gen.ts` of `routers` up
 * to date.
 *
 * **When to use**
 *
 * In Rspack, for routers written with the `Procedure` builder without `.output` / `.error`.
 *
 * **Details**
 *
 * - It generates when the build starts; a build fails on generator errors. Every compilation (including watch rebuilds) regenerates first.
 * - The generated modules are written next to each router module, only when they change.
 *
 * **Gotchas**
 *
 * - Paths are relative to `root` (default: the bundler root, else the working directory).
 *
 * **Example** (Rspack config)
 *
 * ```ts
 * // rspack.config.mjs
 * import { effectTrpcCodegen } from '@effect-trpc/codegen/rspack';
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
export const effectTrpcCodegen = unplugin.rspack;

export type { CodegenPluginOptions } from './unplugin.js';
