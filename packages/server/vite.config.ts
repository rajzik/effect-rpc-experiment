import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: ['src/index.ts', 'src/node.ts'],
    dts: true,
    format: ['esm'],
    sourcemap: true,
  },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    passWithNoTests: true,
    typecheck: {
      enabled: true,
      include: ['test/**/*.test-d.ts', 'test/**/*.test-d.tsx'],
    },
  },
});
