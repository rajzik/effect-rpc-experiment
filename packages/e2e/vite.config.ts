import { defineConfig } from 'vite-plus';

// End-to-end tests across all published packages (driver-owned; root gate R4).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    passWithNoTests: true,
    typecheck: {
      enabled: true,
      include: ['test/**/*.test-d.ts', 'test/**/*.test-d.tsx'],
    },
  },
});
