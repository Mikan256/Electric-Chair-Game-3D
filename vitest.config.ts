import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': r('./src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/game/**', 'src/net/**'],
      exclude: ['src/net/flaxia-client.ts', 'src/net/flaxia-transport.ts'],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 70,
        statements: 78,
      },
    },
  },
});
