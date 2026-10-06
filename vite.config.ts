import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'path';
import { peggyPlugin } from './scripts/peggy';

export default defineConfig({
  plugins: [preact(), peggyPlugin(), viteSingleFile()],
  root: '.',
  build: {
    outDir: 'dist/intermediate',
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      input: resolve(__dirname, 'template/format.html'),
    },
  },
});
