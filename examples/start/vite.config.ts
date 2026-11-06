import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { defineConfig } from 'vite-plus';

import { port } from './port';

export default defineConfig({
  server: { port },
  // `vp preview` serves the production build the Playwright suite runs against.
  preview: { port, strictPort: true },
  plugins: [tanstackStart()],
  build: {
    rolldownOptions: {
      // The shared components (and TanStack's packages) carry `'use client'` for RSC frameworks.
      // Start bundles every module as-is, so rolldown's "directive may not be preserved" notice
      // about them is noise; any other log still goes through.
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
