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
      // Written by the TanStack Router plugin on every build; it asks to be left unlinted.
      'examples/*/src/routeTree.gen.ts',
      // Written by @effect-trpc/codegen (its test fixtures): one-line chains, `Schema.Number` for
      // TS `number`. `test/generate.test.ts` type-checks them (contract check included).
      'packages/codegen/test/fixtures/**/*.gen.ts',
      'packages/codegen/test/.tmp/**',
      // Written by `next build` / `next dev` (and rewritten with its own formatting).
      'examples/next/next-env.d.ts',
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
      // Branding every Schema.Class (`Schema.Class<A, { readonly brand: unique symbol }>`) adds a
      // type argument to every domain class users copy from docs and tests; structural
      // compatibility of decoded classes is fine for this library.
      'effecttsgo/schema-class-missing-brand': 'off',
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
        // Documentation samples show values as bare expressions (`post.slug; // "hello"`), log
        // with console, declare values only to display them, and demonstrate a reserved key.
        files: ['site/snippets/**'],
        rules: {
          'no-console': 'off',
          'no-unused-expressions': 'off',
          'no-unused-vars': 'off',
          'unicorn/no-thenable': 'off',
        },
      },
      {
        // The docs theme imports its stylesheets (tokens, fonts) for their side effects.
        files: ['site/.vitepress/**'],
        rules: { 'import/no-unassigned-import': ['warn', { allow: ['**/*.css'] }] },
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
          'effecttsgo/missing-effect-error': 'off',
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
      'examples/*/src/routeTree.gen.ts',
      'packages/codegen/test/fixtures/**/*.gen.ts',
      'packages/codegen/test/.tmp/**',
      // Written by `next build` / `next dev` (and rewritten with its own formatting).
      'examples/next/next-env.d.ts',
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
