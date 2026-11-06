/**
 * The schema generator as a webpack loader, for bundlers that run webpack loaders but not
 * plugins: Turbopack (Next.js), and webpack itself when a loader is preferred.
 *
 * @since 0.1.0
 */
import path from 'node:path';
import { createGenerator } from './generate.js';
import type { Generator } from './generate.js';
import type { CodegenPluginOptions } from './unplugin.js';

/**
 * The part of the webpack loader context the loader uses (Turbopack implements it too).
 *
 * @category models
 * @since 0.1.0
 */
export interface CodegenLoaderContext {
  readonly getOptions?: (() => Partial<CodegenPluginOptions>) | undefined;
  readonly rootContext?: string | undefined;
  readonly addDependency?: ((file: string) => void) | undefined;
  readonly cacheable?: ((flag?: boolean) => void) | undefined;
}

const generators = new Map<string, Generator>();

const generatorFor = (root: string, project: string, routers: ReadonlyArray<string>): Generator => {
  const key = JSON.stringify([root, project, routers]);
  let generator = generators.get(key);
  if (generator === undefined) {
    generator = createGenerator({ project, routers, cwd: root });
    generators.set(key, generator);
    process.once('exit', () => {
      generator?.close();
    });
  }
  return generator;
};

/**
 * A webpack loader that regenerates the schema modules whenever the module it is applied to (the
 * router module) is compiled, and returns that module unchanged.
 *
 * **When to use**
 *
 * With Turbopack, which does not run bundler plugins: apply it to the router module with a
 * `turbopack.rules` entry in `next.config`. With webpack, prefer `@effect-trpc/codegen/webpack`.
 *
 * **Details**
 *
 * - Options are {@link CodegenPluginOptions}; `routers` defaults to the module the loader runs on
 *   and `root` to the loader's `rootContext`.
 * - It declares the project's source files as dependencies, so editing a model module recompiles
 *   the router module and regenerates (where the bundler supports `addDependency`).
 * - Generator errors fail the module's compilation with the problems as the message; the next
 *   change retries. The checker stays warm for the life of the process.
 *
 * **Gotchas**
 *
 * - It runs when the router module is compiled, which happens only once something imports it:
 *   the server imports `router.gen.ts`, which imports the router module, so commit the generated
 *   modules (or run `effect-trpc-codegen` once) before the first build.
 *
 * **Example** (next.config.ts with Turbopack: `const config: NextConfig = …`)
 *
 * ```ts
 * const config = {
 *   turbopack: {
 *     rules: {
 *       // A glob matching the router module: `**` + `/server/router.ts` (written `\/` here only
 *       // because a JSDoc comment cannot contain the two characters that close it).
 *       '**\/server/router.ts': {
 *         loaders: [
 *           { loader: '@effect-trpc/codegen/loader', options: { routers: ['src/server/router.ts'] } },
 *         ],
 *       },
 *     },
 *   },
 * };
 *
 * export default config;
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const effectTrpcCodegenLoader = function (
  this: CodegenLoaderContext & { readonly resourcePath?: string | undefined },
  source: string,
): string {
  const options = this.getOptions?.() ?? {};
  const root = options.root ?? this.rootContext ?? process.cwd();
  const routers =
    options.routers ??
    (this.resourcePath === undefined ? [] : [path.relative(root, this.resourcePath)]);
  const result = generatorFor(root, options.project ?? 'tsconfig.json', routers).run();
  if (this.addDependency !== undefined) for (const file of result.inputs) this.addDependency(file);
  if (result.errors.length > 0)
    throw new Error(`effect-trpc-codegen:\n${result.errors.join('\n')}`);
  return source;
};

export default effectTrpcCodegenLoader;
