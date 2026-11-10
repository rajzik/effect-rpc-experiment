/**
 * The schema generator as a Bun plugin (see `@rpc-effect/codegen/unplugin`).
 *
 * @since 0.1.0
 */
import { unplugin } from './unplugin.js';

/**
 * Creates the Bun plugin that keeps `router.gen.ts` / `router.client.gen.ts` of `routers` up
 * to date.
 *
 * **When to use**
 *
 * In Bun's bundler (`Bun.build`), for routers written with the `Procedure` builder without `.output` / `.error`.
 *
 * **Details**
 *
 * - It generates when the build starts; a build fails on generator errors. It generates when the build starts.
 * - The generated modules are written next to each router module, only when they change.
 *
 * **Gotchas**
 *
 * - Paths are relative to `root` (default: the bundler root, else the working directory).
 *
 * **Example** (Bun config)
 *
 * ```ts
 * import { effectTrpcCodegen } from '@rpc-effect/codegen/bun';
 *
 * // build.ts, run with `bun build.ts`: Bun.build({ entrypoints: ['src/main.ts'], plugins })
 * export const plugins = [effectTrpcCodegen({ routers: ['src/router.ts'] })];
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const effectTrpcCodegen = unplugin.bun;

export type { CodegenPluginOptions } from './unplugin.js';
