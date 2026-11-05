import { recommended as effectRecommended } from '@effect/tsgo/oxlint-presets';
import { defineConfig } from 'vite-plus';

// Root Vite+ config: shared lint (Oxlint + tsgolint type-check), format (Oxfmt),
// and cached workspace tasks. Package-level vite.config.ts files only hold
// Vitest configuration; lint/fmt are root-only by design (see docs/guide/monorepo).
export default defineConfig({
  lint: {
    // Effect rules (`effecttsgo/*`) from @effect/tsgo. They need the Effect-patched Oxlint binding:
    // run lint through `effect-tsgo vp …` (the `check` / `lint` package scripts do).
    extends: [effectRecommended],
    plugins: ['typescript', 'import', 'promise', 'unicorn', 'oxc'],
    categories: {
      correctness: 'error',
      suspicious: 'warn',
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    ignorePatterns: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/.output/**',
      '**/.jsdoc-examples/**',
      'site/.vitepress/cache/**',
      'site/.vitepress/dist/**',
      'site/api/**',
    ],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // Effect's discriminant convention is `_tag`; underscore-prefixed names are idiomatic.
      'no-underscore-dangle': 'off',
      // Effect code uses generators and `yield*` heavily; these rules misfire on it.
      'unicorn/no-useless-undefined': 'off',
      'unicorn/no-array-callback-reference': 'off',
      'unicorn/no-array-for-each': 'off',
      'unicorn/filename-case': 'off',
      'unicorn/no-null': 'off',
      'typescript/no-namespace': 'off',
      'typescript/no-explicit-any': 'off',
      'import/no-cycle': 'error',
      // effect-trpc is built on `effect/rpc`, which Effect marks unstable: every import would warn.
      'effecttsgo/unstable-api-usage': 'off',
      // Proxy/adapter internals erase rpc types on purpose and restore them at the public API, the
      // same trade-off as `typescript/no-unsafe-type-assertion` (a warning here too).
      'effecttsgo/any-unknown-in-error-context': 'warn',
      'effecttsgo/unsafe-effect-type-assertion': 'warn',
    },
    overrides: [
      {
        files: ['packages/tanstack-react-query/**', 'packages/next/**', 'packages/start/**'],
        plugins: ['react'],
        rules: {
          'react/self-closing-comp': 'error',
          'react/jsx-key': 'error',
        },
      },
      {
        files: ['packages/electron/**', 'packages/server/**', 'packages/test-utils/**'],
        env: { node: true },
      },
      {
        files: ['**/*.test.ts', '**/*.test.tsx', '**/*.test-d.ts', '**/*.test-d.tsx', '**/test/**'],
        plugins: ['vitest'],
        rules: {
          'no-console': 'off',
          'vitest/no-disabled-tests': 'error',
          // Tests build ad-hoc layers and effects with unknown channels on purpose.
          'effecttsgo/any-unknown-in-error-context': 'off',
          'effecttsgo/unsafe-effect-type-assertion': 'off',
          'vitest/no-focused-tests': 'error',
        },
      },
      {
        // Type tests write effects only to check their types; they are never run.
        files: ['**/*.test-d.ts', '**/*.test-d.tsx'],
        // Type tests also feed deliberately wrong values to `@ts-expect-error` lines.
        rules: {
          'effecttsgo/floating-effect': 'off',
          'effecttsgo/missing-layer-context': 'off',
        },
      },
    ],
  },
  fmt: {
    singleQuote: true,
    semi: true,
    printWidth: 100,
    trailingComma: 'all',
    ignorePatterns: [
      '**/dist/**',
      'pnpm-lock.yaml',
      '**/__snapshots__/**',
      '**/.jsdoc-examples/**',
      'site/.vitepress/cache/**',
      'site/.vitepress/dist/**',
      'site/api/**',
    ],
  },
  run: {
    cache: true,
    tasks: {
      typecheck: {
        command: 'tsgo --build tsconfig.json',
        cache: {
          input: [
            'packages/*/src/**',
            'packages/*/test/**',
            'packages/*/tsconfig.json',
            'tsconfig.base.json',
            'tsconfig.json',
          ],
        },
      },
    },
  },
});
