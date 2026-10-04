import { defineConfig } from 'vitest/config';

// 單元測試只測 src/sim、src/input 等純邏輯（不需要 WebGL）
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
