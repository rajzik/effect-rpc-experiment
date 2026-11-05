import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: { main: 'src/main.ts' },
    format: ['esm'],
    platform: 'node',
    deps: { neverBundle: ['electron'], alwaysBundle: [/^@effect-trpc\//, 'effect', /^effect\//] },
  },
});
