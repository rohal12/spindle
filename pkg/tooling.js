import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load built-in macro metadata generated at build time
const registryPath = join(__dirname, 'macro-registry.json');
let builtins = [];
try {
  builtins = JSON.parse(readFileSync(registryPath, 'utf-8'));
} catch {
  // macro-registry.json not yet built — empty builtins
}

const metadata = new Map();
for (const m of builtins) metadata.set(m.name.toLowerCase(), m);

/**
 * Metadata-only defineMacro for tooling.
 * Captures macro metadata without creating Preact components.
 * LSP servers call this to register user-defined macros discovered in story scripts.
 */
export function defineMacro(config) {
  const name = config.name.toLowerCase();
  metadata.set(name, {
    name: config.name,
    block: config.block ?? (config.subMacros?.length > 0 ? true : false),
    subMacros: config.subMacros ?? [],
    storeVar: config.storeVar,
    interpolate: config.interpolate,
    merged: config.merged,
    description: config.description,
    parameters: config.parameters,
    source: 'user',
  });
}

/**
 * Return metadata for all registered macros (built-in + user-defined).
 */
export function getMacroRegistry() {
  return Array.from(metadata.values());
}
