/**
 * The schema generator as a Vite plugin (see `@effect-trpc/codegen/unplugin`).
 *
 * @since 0.1.0
 */
import { unplugin } from './unplugin.js';

/**
 * Creates the Vite plugin that keeps `router.gen.ts` / `router.client.gen.ts` of `routers` up
 * to date.
 *
 * **When to use**
 *
 * In Vite (also Vitest, TanStack Start, electron-vite, Astro, SvelteKit, Nuxt, …), for routers written with the `Procedure` builder without `.output` / `.error`.
 *
 * **Details**
 *
 * - It generates when the build starts; a build fails on generator errors. In dev (`vite`) generator errors are warnings and every change to a source module regenerates; `vite build` fails on them.
 * - The generated modules are written next to each router module, only when they change.
 *
 * **Gotchas**
 *
 * - Paths are relative to `root` (default: the bundler root, else the working directory).
 *
 * **Example** (Vite config)
 *
 * ```ts
 * // vite.config.ts
 * import { effectTrpcCodegen } from '@effect-trpc/codegen/vite';
 *
 * export default {
 *   plugins: [effectTrpcCodegen({ routers: ['src/router.ts'] })],
 * };
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const effectTrpcCodegen = unplugin.vite;

export type { CodegenPluginOptions } from './unplugin.js';
