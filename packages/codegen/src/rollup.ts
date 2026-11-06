/**
 * The schema generator as a Rollup plugin (see `@effect-trpc/codegen/unplugin`).
 *
 * @since 0.1.0
 */
import { unplugin } from './unplugin.js';

/**
 * Creates the Rollup plugin that keeps `router.gen.ts` / `router.client.gen.ts` of `routers` up
 * to date.
 *
 * **When to use**
 *
 * In Rollup, for routers written with the `Procedure` builder without `.output` / `.error`.
 *
 * **Details**
 *
 * - It generates when the build starts; a build fails on generator errors. In `rollup --watch` every rebuild regenerates first.
 * - The generated modules are written next to each router module, only when they change.
 *
 * **Gotchas**
 *
 * - Paths are relative to `root` (default: the bundler root, else the working directory).
 *
 * **Example** (Rollup config)
 *
 * ```ts
 * // rollup.config.mjs
 * import { effectTrpcCodegen } from '@effect-trpc/codegen/rollup';
 *
 * export default {
 *   input: 'src/main.ts',
 *   plugins: [effectTrpcCodegen({ routers: ['src/router.ts'] })],
 * };
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const effectTrpcCodegen = unplugin.rollup;

export type { CodegenPluginOptions } from './unplugin.js';
