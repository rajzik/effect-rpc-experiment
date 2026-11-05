import { defineConfig } from 'vitepress';

export default defineConfig({
  base: '/effect-rpc-experiment/',
  title: 'effect-trpc',
  description: 'End-to-end type-safe RPC for Effect v4',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    search: { provider: 'local' },
  },
});
