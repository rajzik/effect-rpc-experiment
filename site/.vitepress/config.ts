// VitePress config for the effect-trpc reference site (deployed to GitHub Pages).
import { defineConfig } from 'vitepress';

import { sidebar } from './sidebar';

const repo = 'https://github.com/rajzik/effect-rpc-experiment';

export default defineConfig({
  base: '/effect-rpc-experiment/',
  title: 'effect-trpc',
  description: 'End-to-end type-safe RPC for Effect v4, with TanStack Query and framework adapters',
  cleanUrls: true,
  lastUpdated: true,
  appearance: true,
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/effect-rpc-experiment/logo.svg' }]],
  markdown: {
    theme: { light: 'github-light', dark: 'github-dark-default' },
  },
  themeConfig: {
    logo: { light: '/logo.svg', dark: '/logo-dark.svg', alt: '' },
    siteTitle: 'effect-trpc',
    nav: [
      {
        text: 'Guide',
        link: '/guide/introduction',
        activeMatch: '^/guide/(?!frameworks|advanced)',
      },
      { text: 'Frameworks', link: '/guide/frameworks/next', activeMatch: '^/guide/frameworks/' },
      { text: 'Advanced', link: '/guide/advanced/auth', activeMatch: '^/guide/advanced/' },
      { text: 'API', link: '/api/', activeMatch: '^/api/' },
    ],
    sidebar,
    socialLinks: [{ icon: 'github', link: repo }],
    search: { provider: 'local' },
    outline: { level: [2, 3], label: 'On this page' },
    editLink: {
      pattern: `${repo}/edit/main/site/:path`,
      text: 'Edit this page on GitHub',
    },
    docFooter: { prev: 'Previous', next: 'Next' },
  },
});
