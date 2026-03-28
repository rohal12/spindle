/**
 * Dump the built-in macro registry metadata to JSON.
 * Run after register-builtins has been imported (side-effect registration).
 *
 * Usage: bun run scripts/dump-macro-registry.ts
 * Output: dist/pkg/macro-registry.json
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
writeFileSync(outputPath, JSON.stringify(registry, null, 2), 'utf-8');

console.log(
  `Dumped ${registry.length} macro metadata entries to dist/pkg/macro-registry.json`,
);
