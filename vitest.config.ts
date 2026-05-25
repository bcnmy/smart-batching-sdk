import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      'smart-batching': resolve(__dirname, 'src/index.ts'),
    },
  },
  test: {
    env: loadEnv(mode, process.cwd(), ''),
    testTimeout: 500_000,
    retry: 2,
    exclude: ['**/node_modules/**', 'src/test/integration/**'],
  },
}));
