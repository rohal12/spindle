import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { peggyPlugin } from './scripts/peggy';

export default defineConfig({
  plugins: [preact(), peggyPlugin()],
  test: {
    environment: 'node',
    setupFiles: ['./src/macros/register-builtins.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['test/e2e/**'],
    // A deep property-test run (FC_NUM_RUNS, see test/property/config.ts)
    // takes as long as it needs instead of hitting the 5s default.
    ...(process.env.FC_NUM_RUNS ? { testTimeout: 0 } : {}),
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts'],
      reporter: ['text', 'json', 'json-summary'],
    },
  },
});
