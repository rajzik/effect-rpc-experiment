// Sidebar: one tree for the guide (incl. frameworks and advanced), one for the API reference.
import type { DefaultTheme } from 'vitepress';

const guide: DefaultTheme.SidebarItem[] = [
  {
    text: 'Getting started',
    items: [
      { text: 'Introduction', link: '/guide/introduction' },
      { text: 'Installation', link: '/guide/installation' },
      { text: 'Quick start', link: '/guide/quick-start' },
    ],
  },
  {
    text: 'Core concepts',
    items: [
      { text: 'Routers and procedures', link: '/guide/concepts/routers' },
      { text: 'Routers as services', link: '/guide/concepts/router-services' },
      { text: 'Schemas and serialization', link: '/guide/concepts/schemas' },
      { text: 'The error model', link: '/guide/concepts/errors' },
      { text: 'Type inference', link: '/guide/concepts/inference' },
    ],
  },
  {
    text: 'Server',
    items: [
      { text: 'Handlers', link: '/guide/server/handlers' },
      { text: 'Middleware and context', link: '/guide/server/middleware' },
      { text: 'Serving over HTTP', link: '/guide/server/serving' },
      { text: 'Serialization formats', link: '/guide/server/serialization' },
      { text: 'Streams and subscriptions', link: '/guide/server/streams' },
      { text: 'In-process caller', link: '/guide/server/caller' },
    ],
  },
  {
    text: 'Client',
    items: [
      { text: 'Promise client', link: '/guide/client/create-client' },
      { text: 'Effect client', link: '/guide/client/effect-client' },
      { text: 'Links', link: '/guide/client/links' },
      { text: 'Headers, cancellation, options', link: '/guide/client/call-options' },
      { text: 'Client middleware', link: '/guide/client/middleware' },
    ],
  },
  {
    text: 'TanStack React Query',
    items: [
      { text: 'Setup', link: '/guide/react-query/setup' },
      { text: 'Queries', link: '/guide/react-query/queries' },
      { text: 'Mutations', link: '/guide/react-query/mutations' },
      { text: 'Infinite queries', link: '/guide/react-query/infinite' },
      { text: 'Subscriptions', link: '/guide/react-query/subscriptions' },
      { text: 'Keys and filters', link: '/guide/react-query/keys' },
      { text: 'SSR hydration', link: '/guide/react-query/hydration' },
      { text: 'Differences from tRPC', link: '/guide/react-query/differences' },
    ],
  },
  {
    text: 'Frameworks',
    items: [
      { text: 'Next.js', link: '/guide/frameworks/next' },
      { text: 'TanStack Start', link: '/guide/frameworks/start' },
      { text: 'Electron', link: '/guide/frameworks/electron' },
    ],
  },
  {
    text: 'Testing',
    items: [
      { text: 'Test harness', link: '/guide/testing/harness' },
      { text: 'Testing with the caller', link: '/guide/testing/caller' },
      { text: 'Type tests', link: '/guide/testing/type-tests' },
    ],
  },
  {
    text: 'Advanced',
    items: [
      { text: 'Authentication', link: '/guide/advanced/auth' },
      { text: 'Typed errors through SSR', link: '/guide/advanced/ssr-errors' },
      { text: 'Multiple routers', link: '/guide/advanced/multiple-routers' },
      { text: 'Live data over WebSocket', link: '/guide/advanced/live-data' },
      { text: 'Cancellation and timeouts', link: '/guide/advanced/cancellation' },
      { text: 'Defects vs domain errors', link: '/guide/advanced/defects' },
      { text: 'Writing a custom link', link: '/guide/advanced/custom-link' },
      { text: 'Migrating from tRPC', link: '/guide/advanced/migrating-from-trpc' },
      { text: 'Known limits', link: '/guide/advanced/limits' },
    ],
  },
];

const api: DefaultTheme.SidebarItem[] = [
  {
    text: 'API reference',
    items: [
      { text: 'Overview', link: '/api/' },
      { text: '@effect-trpc/core', link: '/api/core' },
      { text: '@effect-trpc/server', link: '/api/server' },
      { text: '@effect-trpc/server/node', link: '/api/server-node' },
      { text: '@effect-trpc/client', link: '/api/client' },
      { text: '@effect-trpc/tanstack-react-query', link: '/api/tanstack-react-query' },
      { text: '@effect-trpc/next', link: '/api/next' },
      { text: '@effect-trpc/start', link: '/api/start' },
      { text: '@effect-trpc/electron', link: '/api/electron' },
      { text: '@effect-trpc/electron/main', link: '/api/electron-main' },
      { text: '@effect-trpc/electron/preload', link: '/api/electron-preload' },
      { text: '@effect-trpc/electron/renderer', link: '/api/electron-renderer' },
      { text: '@effect-trpc/test-utils', link: '/api/test-utils' },
    ],
  },
];

export const sidebar: DefaultTheme.Sidebar = { '/guide/': guide, '/api/': api };
