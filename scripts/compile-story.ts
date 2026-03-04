/**
 * Full production pipeline: use twee-ts to compile dev/story.twee
 * with the built format.js into dist/story.html.
 *
 * Requires dist/format.js to exist (run `bun run build` first).
 */
import { resolve, dirname } from 'path';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { compileToFile } from '@rohal12/twee-ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const formatJsPath = resolve(projectRoot, 'dist/format.js');
if (!existsSync(formatJsPath)) {
  console.error('dist/format.js not found. Run `bun run build` first.');
  process.exit(1);
}

// Install format.js where twee-ts can discover it
const formatsDir = resolve(projectRoot, 'dist/storyformats/spindle');
mkdirSync(formatsDir, { recursive: true });
copyFileSync(formatJsPath, resolve(formatsDir, 'format.js'));

const outputPath = resolve(projectRoot, 'dist/story.html');
console.log('Compiling dev/story.twee with twee-ts...');

await compileToFile({
  sources: [
    resolve(projectRoot, 'dev/story.twee'),
    resolve(projectRoot, 'dev/story.css'),
  ],
  outFile: outputPath,
  formatPaths: [resolve(projectRoot, 'dist/storyformats')],
});

console.log(`Compiled: ${outputPath}`);
