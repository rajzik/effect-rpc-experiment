import { defineConfig } from '@playwright/test';

import { port } from './port';

// The suite runs against the production build: `vp build`, then `vp preview` over the built output
// (Start has no standalone Node server). EXAMPLES_TEST=1 enables the test-only `testing.reset`
// procedure on the server.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm example:build && pnpm example:start',
    port,
    timeout: 300_000,
    reuseExistingServer: false,
    env: { EXAMPLES_TEST: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
