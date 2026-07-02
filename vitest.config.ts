import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Vitest 配置：纯逻辑用 node 环境，DOM 相关用 jsdom
export default defineConfig({
  test: {
    environment: 'jsdom',          // 大多数模块需要 DOM（createElement 等），默认 jsdom
    globals: false,                // 显式 import describe/it/expect，避免全局污染
    include: ['src/**/*.test.ts', 'entrypoints/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts', 'src/**/types.ts'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
