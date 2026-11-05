// VitePress config for the effect-trpc reference site (GitHub Pages and Vercel).
import { defineConfig } from 'vitepress';

import { sidebar } from './sidebar';

const repo = 'https://github.com/rajzik/effect-rpc-experiment';

// Where the site is served: GitHub Pages serves it under the repo name, Vercel at the root
// (`DOCS_BASE=/`, set by vercel.json). Must start and end with `/`.
const base = process.env['DOCS_BASE'] ?? '/effect-rpc-experiment/';

export default defineConfig({
  base,
  title: 'effect-trpc',
  description: 'End-to-end type-safe RPC for Effect v4, with TanStack Query and framework adapters',
  srcExclude: ['README.md'],
  cleanUrls: true,
  lastUpdated: true,
  appearance: true,
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }]],
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
