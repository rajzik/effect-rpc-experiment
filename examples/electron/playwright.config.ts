import { defineConfig } from '@playwright/test';

// The suite drives the production build (`example:test` builds first). `EXAMPLES_TEST=1` is passed
// to the app by the fixtures (`electron.launch({ env })`), which enables the test-only
// `testing.reset` procedure. The first launch can download the Electron binary, so the timeouts of
// the launch (see fixtures.ts) are generous; a test itself is not.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: 'list',
  timeout: 60_000,
  use: { trace: 'retain-on-failure' },
});
