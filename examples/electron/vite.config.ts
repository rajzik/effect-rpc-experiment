import { defineConfig } from 'vite-plus';

const bundled = {
  alwaysBundle: [/^@effect-trpc\//, 'effect', /^effect\//],
  neverBundle: ['electron'],
};

// `example:build` = `vp pack` (main + preload) then `vp build` (renderer), all into `dist/`.
// `dist/` is removed by the script first: the three builds share it, so none of them cleans it.
export default defineConfig({
  pack: [
    {
      // The main process: ESM, run by Electron.
      entry: { main: 'src/main.ts' },
      format: ['esm'],
      platform: 'node',
      clean: false,
      // `import.meta.dirname` stays valid: the output is `dist/main.mjs`.
      deps: { ...bundled, alwaysBundle: [...bundled.alwaysBundle, /^@effect-trpc-examples\//] },
    },
    {
      // A sandboxed preload cannot `require` npm packages and is not an ES module: one CJS file.
      entry: { preload: 'src/preload.ts' },
      format: ['cjs'],
      platform: 'node',
      clean: false,
      deps: bundled,
    },
  ],
  // The renderer: a Vite app whose output `loadFile` opens from disk.
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    rolldownOptions: {
      // The shared components carry `'use client'` for RSC frameworks; Vite bundles every module
      // as-is, so rolldown's "directive may not be preserved" notice about them (and TanStack) is noise.
      onLog(level, log, defaultHandler) {
        if (
          log.code === 'MODULE_LEVEL_DIRECTIVE' &&
          /\/(shared\/src\/ui|@tanstack)\//.test(log.id ?? '')
        ) {
          return;
        }
        defaultHandler(level, log);
      },
    },
  },
});
