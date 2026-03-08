import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

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
};

// Write the format.js file
const output = `window.storyFormat(${JSON.stringify(formatData)})`;
const outputDir = resolve(projectRoot, 'dist');
mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, 'format.js'), output, 'utf-8');

console.log(`Built dist/format.js (${(output.length / 1024).toFixed(1)} KB)`);

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
