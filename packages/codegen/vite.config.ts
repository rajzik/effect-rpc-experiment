import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: ['src/index.ts', 'src/cli.ts', 'src/vite.ts'],
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
