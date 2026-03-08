import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/e2e/**/*.test.ts'],
    globalSetup: ['test/e2e/global-setup.ts'],
    testTimeout: 30000,
    hookTimeout: 15000,
  },
});
