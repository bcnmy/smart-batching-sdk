import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      '@bcnmy/smart-batching': resolve(__dirname, 'src/index.ts'),
    },
  },
  test: {
    env: loadEnv(mode, process.cwd(), ''),
    testTimeout: 500_000,
    retry: 2,
    include: ['src/test/integration/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    // Run test files one at a time — prevents nonce conflicts and balance races
    // when multiple files share the same EOA/SCA on a live testnet
    fileParallelism: false,
    sequence: {
      // Run tests within each file sequentially (respects beforeEach top-ups)
      concurrent: false,
    },
  },
}));
