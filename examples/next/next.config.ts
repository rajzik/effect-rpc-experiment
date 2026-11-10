import type { NextConfig } from 'next';

const config: NextConfig = {
  // The shared package ships TypeScript source (and `'use client'` components), so Next compiles it.
  transpilePackages: ['@rpc-effect-examples/shared'],
  // Types are checked by the workspace (`pnpm check`), not a second time by `next build`.
  typescript: { ignoreBuildErrors: true },
};

export default config;
