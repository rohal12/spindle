/**
 * Full production pipeline: use tweenode to compile dev/story.twee
 * with the built format.js into dist/story.html.
 *
 * Requires dist/format.js to exist (run `bun run build` first).
 */
import { resolve, dirname } from 'path';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { setupTweego, tweenode } from 'tweenode';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const formatJsPath = resolve(projectRoot, 'dist/format.js');
if (!existsSync(formatJsPath)) {
  console.error('dist/format.js not found. Run `bun run build` first.');
  process.exit(1);
}

// 1. Ensure tweego binary is available
console.log('Setting up tweego via tweenode...');
await setupTweego({
  storyFormats: {
    cleanTweegoBuiltins: true,
    formats: [],
  },
});
console.log('Tweego ready.');

// 2. Copy our format.js into tweenode's storyformats directory
const tweenodeFormatsDir = resolve(
  process.cwd(),
  '.tweenode/storyformats/spindle',
);
mkdirSync(tweenodeFormatsDir, { recursive: true });
copyFileSync(formatJsPath, resolve(tweenodeFormatsDir, 'format.js'));
console.log(`Installed format.js to ${tweenodeFormatsDir}`);

// 3. Compile the story
const outputPath = resolve(projectRoot, 'dist/story.html');
console.log('Compiling dev/story.twee...');

const tweego = await tweenode({
  build: {
    input: {
      storyDir: resolve(projectRoot, 'dev/story.twee'),
      styles: resolve(projectRoot, 'dev/story.css'),
    },
    output: {
      mode: 'file',
      fileName: outputPath,
    },
  },
});

await tweego.process();
console.log(`Compiled: ${outputPath}`);
