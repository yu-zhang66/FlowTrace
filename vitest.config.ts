import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.{test,spec}.{ts,js}', 'tests/**/*.{test,spec}.{ts,js}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts', '**/*.d.ts.map', '**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.d.ts', '**/*.d.ts.map', '**/*.test.ts', '**/*.test.js']
    },
    includeSource: [],
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      // Resolve the TypeScript entry explicitly so tests exercise newly added
      // source exports rather than stale checked-in JavaScript siblings.
      '@flowtrace/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@flowtrace/adapter': resolve(__dirname, 'packages/adapter/src'),
      '@flowtrace/runner': resolve(__dirname, 'packages/runner/src'),
      '@flowtrace/reporter': resolve(__dirname, 'packages/reporter/src'),
      '@flowtrace/ai': resolve(__dirname, 'packages/ai/src'),
    }
  }
});
