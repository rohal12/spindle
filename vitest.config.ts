import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
  },
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
    server: {
      deps: {
        inline: [/zustand/],
      },
    },
  },
});
