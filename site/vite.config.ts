// Site tests: the oracles in test/ and the runnable testing samples in snippets/testing/.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite-plus';

const snippet = (path: string) =>
  fileURLToPath(new URL(`./snippets/shared/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@/router': snippet('router.ts'), '@/server': snippet('server.ts') },
  },
  test: {
    include: ['test/**/*.test.ts', 'snippets/testing/**/*.test.ts'],
  },
});
