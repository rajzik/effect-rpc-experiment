import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: [
      'src/index.ts',
      'src/cli.ts',
      'src/unplugin.ts',
      'src/vite.ts',
      'src/rollup.ts',
      'src/rolldown.ts',
      'src/webpack.ts',
      'src/rspack.ts',
      'src/rsbuild.ts',
      'src/esbuild.ts',
      'src/farm.ts',
      'src/bun.ts',
      'src/loader.ts',
    ],
    dts: true,
    format: ['esm'],
    sourcemap: true,
  },
  test: {
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
    // The generator starts the TypeScript checker process per test file.
    testTimeout: 60_000,
    typecheck: {
      enabled: true,
      include: ['test/**/*.test-d.ts'],
    },
  },
});
