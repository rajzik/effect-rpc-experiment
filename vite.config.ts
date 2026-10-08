import { defineConfig } from 'vite-plus';

// Root Vite+ config: shared lint (Oxlint + tsgolint type-check), format (Oxfmt),
// and cached workspace tasks. Package-level vite.config.ts files only hold
// Vitest configuration; lint/fmt are root-only by design (see docs/guide/monorepo).
export default defineConfig({
  lint: {
    plugins: ['typescript', 'import', 'promise', 'unicorn', 'oxc'],
    categories: {
      correctness: 'error',
      suspicious: 'warn',
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    ignorePatterns: ['**/dist/**', '**/node_modules/**', '**/.next/**', '**/.output/**'],
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
        files: ['**/*.test.ts', '**/*.test.tsx', '**/*.test-d.ts', '**/test/**'],
        plugins: ['vitest'],
        rules: {
          'no-console': 'off',
          'vitest/no-disabled-tests': 'error',
          'vitest/no-focused-tests': 'error',
        },
      },
    ],
  },
  fmt: {
    singleQuote: true,
    semi: true,
    printWidth: 100,
    trailingComma: 'all',
    ignorePatterns: ['**/dist/**', 'pnpm-lock.yaml', '**/__snapshots__/**'],
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
