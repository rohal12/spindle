/**
 * Dump the built-in macro registry metadata to JSON.
 * Run after register-builtins has been imported (side-effect registration).
 *
 * Usage: bun run scripts/dump-macro-registry.ts
 * Output: dist/pkg/macro-registry.json, and the same as a module,
 * dist/pkg/macro-registry.js, which pkg/tooling.js imports so that a bundler
 * inlines the list (it reads no file at run time).
 */
import '../src/macros/register-builtins';
import { getMacroRegistry } from '../src/registry';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(__dirname, '..', 'dist', 'pkg');
mkdirSync(outputDir, { recursive: true });

const registry = getMacroRegistry();
const outputPath = resolve(outputDir, 'macro-registry.json');
const json = JSON.stringify(registry, null, 2);
writeFileSync(outputPath, json, 'utf-8');
writeFileSync(
  resolve(outputDir, 'macro-registry.js'),
  `export default ${json};\n`,
  'utf-8',
);

console.log(
  `Dumped ${registry.length} macro metadata entries to dist/pkg/macro-registry.json and .js`,
);
