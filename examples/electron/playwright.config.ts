import { defineConfig } from '@playwright/test';

export default defineConfig({ testDir: 'test', workers: 1, retries: 0 });
