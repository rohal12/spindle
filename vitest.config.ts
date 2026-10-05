import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  test: {
    environment: 'node',
    setupFiles: ['./src/macros/register-builtins.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['test/e2e/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts'],
      reporter: ['text', 'json', 'json-summary'],
    },
  },
});
