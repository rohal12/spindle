import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, normalizePath, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { peggyPlugin } from './peggy';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// Read the Vite build output (single HTML file with inlined JS/CSS)
const htmlPath = resolve(projectRoot, 'dist/intermediate/template/format.html');
const html = readFileSync(htmlPath, 'utf-8');

// Read format metadata (version comes from package.json so it stays in sync with npm)
const packageJson = JSON.parse(
  readFileSync(resolve(projectRoot, 'package.json'), 'utf-8'),
);
const formatMeta = JSON.parse(
  readFileSync(resolve(projectRoot, 'format.json'), 'utf-8'),
);
formatMeta.version = packageJson.version;

/**
 * The format's `hydrate`: the Twine editor extensions (src/twine-editor/),
 * which Twine 2.4+ runs with `new Function(hydrate)` bound to an empty
 * object. The IIFE's global lives in a local `var` inside a function called
 * with that object, so the code only assigns `this.editorExtensions` and
 * leaks no globals. `builtin-macros.ts` is swapped for the macro list that
 * scripts/dump-macro-registry.ts wrote (run before this script), so the
 * bundle carries no Preact or runtime.
 */
async function buildHydrate(): Promise<string> {
  const registryPath = resolve(projectRoot, 'dist/pkg/macro-registry.js');
  if (!existsSync(registryPath)) {
    throw new Error(
      `${registryPath} not found. Run scripts/dump-macro-registry.ts first.`,
    );
  }
  // Vite's resolved ids use forward slashes, also on Windows
  const builtinMacrosPath = normalizePath(
    resolve(projectRoot, 'src/twine-editor/builtin-macros.ts'),
  );
  const builtinMacrosFromRegistry: Plugin = {
    name: 'spindle-builtin-macros-from-registry',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      return resolved && normalizePath(resolved.id) === builtinMacrosPath
        ? '\0spindle-builtin-macros'
        : null;
    },
    load(id) {
      return id === '\0spindle-builtin-macros'
        ? `export { default as builtinMacros } from ${JSON.stringify(registryPath)};`
        : null;
    },
  };
  const result = await build({
    configFile: false,
    logLevel: 'warn',
    plugins: [builtinMacrosFromRegistry, peggyPlugin()],
    build: {
      write: false,
      minify: true,
      target: 'es2019',
      chunkSizeWarningLimit: 4096,
      lib: {
        entry: resolve(projectRoot, 'src/twine-editor/index.ts'),
        formats: ['iife'],
        name: '__spindleTwineEditor',
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs
    .flatMap((output) => ('output' in output ? output.output : []))
    .find((file) => file.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') {
    throw new Error('The Twine editor build produced no chunk.');
  }
  return [
    '/* spindle twine-editor */',
    `(function(){${chunk.code};this.editorExtensions=__spindleTwineEditor.editorExtensions;}).call(this);`,
  ].join('\n');
}

// Build the story format JSONP payload
const formatData = {
  name: formatMeta.name,
  version: formatMeta.version,
  author: formatMeta.author,
  description: formatMeta.description,
  image: formatMeta.image || '',
  url: formatMeta.url || '',
  license: formatMeta.license || '',
  proofing: false,
  source: html,
  hydrate: await buildHydrate(),
};

// Write the format.js file
const output = `window.storyFormat(${JSON.stringify(formatData)})`;
const outputDir = resolve(projectRoot, 'dist');
mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, 'format.js'), output, 'utf-8');

console.log(
  `Built dist/format.js (${(output.length / 1024).toFixed(1)} KB, hydrate ${(formatData.hydrate.length / 1024).toFixed(1)} KB)`,
);

// Build the npm package structure in dist/pkg/
const pkgDir = resolve(outputDir, 'pkg');
mkdirSync(pkgDir, { recursive: true });

// Copy format.js into pkg/
copyFileSync(resolve(outputDir, 'format.js'), resolve(pkgDir, 'format.js'));

// Copy the ESM wrapper
copyFileSync(resolve(projectRoot, 'pkg/index.js'), resolve(pkgDir, 'index.js'));

// Copy type declarations
const pkgTypesDir = resolve(pkgDir, 'types');
mkdirSync(pkgTypesDir, { recursive: true });
copyFileSync(
  resolve(projectRoot, 'pkg/types/index.d.ts'),
  resolve(pkgTypesDir, 'index.d.ts'),
);
copyFileSync(
  resolve(projectRoot, 'pkg/types/globals.d.ts'),
  resolve(pkgTypesDir, 'globals.d.ts'),
);

console.log('Built dist/pkg/ (npm package)');

// Copy tooling entry point
copyFileSync(
  resolve(projectRoot, 'pkg/tooling.js'),
  resolve(pkgDir, 'tooling.js'),
);

// Copy tooling type declarations
copyFileSync(
  resolve(projectRoot, 'types/tooling.d.ts'),
  resolve(pkgTypesDir, 'tooling.d.ts'),
);

console.log('Copied tooling entry point to dist/pkg/');

// Bundle the StoryVariables parser and the markup validator for the tooling
// entry point (src/tooling.ts). They are plain TypeScript with no
// Preact/DOM dependencies, so Node tooling can run them.
await build({
  configFile: false,
  logLevel: 'warn',
  plugins: [peggyPlugin()],
  build: {
    outDir: pkgDir,
    emptyOutDir: false,
    target: 'es2020',
    minify: false,
    lib: {
      entry: resolve(projectRoot, 'src/tooling.ts'),
      formats: ['es'],
      fileName: () => 'story-variables.js',
    },
  },
});

console.log('Built dist/pkg/story-variables.js (tooling)');

// Bundle the headless entry point (`@rohal12/spindle/headless`): boots a
// compiled story inside a caller-provided DOM (happy-dom/jsdom) in Node.
// Runtime dependencies stay external so the consumer's single copy is used.
// Nothing here may import `react`: the store binds `zustand/vanilla` to Preact
// (src/preact-store.ts), so plain Node resolution works without an alias.
const RUNTIME_DEPS = /^(preact|zustand|immer|micromark)(\/|-|$)/;
await build({
  configFile: false,
  logLevel: 'warn',
  plugins: [preact(), peggyPlugin()],
  build: {
    outDir: pkgDir,
    emptyOutDir: false,
    target: 'es2022',
    minify: false,
    lib: {
      entry: resolve(projectRoot, 'src/headless.ts'),
      formats: ['es'],
      fileName: () => 'headless.js',
    },
    rollupOptions: {
      external: (id) => RUNTIME_DEPS.test(id),
    },
  },
});

console.log('Built dist/pkg/headless.js (headless)');

// Bundle the play entry point (`@rohal12/spindle/play`) and its worker. Both
// are emitted flat in dist/pkg/: they find the worker, headless.js, the format
// and package.json by URLs relative to themselves. happy-dom and twee-ts are
// optional peer dependencies, loaded at runtime and never bundled.
const PLAY_EXTERNAL = /^(node:|happy-dom$|@rohal12\/twee-ts$)/;
for (const [entry, fileName] of [
  ['src/play/index.ts', 'play.js'],
  ['src/play/worker.ts', 'play-worker.js'],
] as const) {
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir: pkgDir,
      emptyOutDir: false,
      target: 'es2022',
      minify: false,
      lib: {
        entry: resolve(projectRoot, entry),
        formats: ['es'],
        fileName: () => fileName,
      },
      rollupOptions: {
        external: (id) => RUNTIME_DEPS.test(id) || PLAY_EXTERNAL.test(id),
      },
    },
  });
}

console.log('Built dist/pkg/play.js and dist/pkg/play-worker.js (play)');
