/**
 * The schema generator as a Rolldown plugin (see `@rpc-effect/codegen/unplugin`).
 *
 * @since 0.1.0
 */
import { unplugin } from './unplugin.js';

/**
 * Creates the Rolldown plugin that keeps `router.gen.ts` / `router.client.gen.ts` of `routers` up
 * to date.
 *
 * **When to use**
 *
 * In Rolldown, for routers written with the `Procedure` builder without `.output` / `.error`.
 *
 * **Details**
 *
 * - It generates when the build starts; a build fails on generator errors. In watch mode every rebuild regenerates first.
 * - The generated modules are written next to each router module, only when they change.
 *
 * **Gotchas**
 *
 * - Paths are relative to `root` (default: the bundler root, else the working directory).
 *
 * **Example** (Rolldown config)
 *
 * ```ts
 * // rolldown.config.ts
 * import { effectTrpcCodegen } from '@rpc-effect/codegen/rolldown';
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
export const effectTrpcCodegen = unplugin.rolldown;

export type { CodegenPluginOptions } from './unplugin.js';
