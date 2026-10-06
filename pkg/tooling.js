import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkParameterTypes,
  collectStoryPassageReferences,
  validateStoryMarkup,
} from './story-variables.js';

export {
  parseStoryVariables,
  formatDiagnostic,
  findCodeEnd,
  lexJs,
  lexTemplate,
  scanStringLiteral,
  MarkupError,
  parseSelectors,
  tokenizeMarkup,
  tokenizeMarkupTolerant,
  transform,
  passageTarget,
  evaluatePassageName,
  SIGIL_SCOPES,
  isSigil,
  endsWithOperator,
  readQuoted,
  splitArgs,
  splitTopLevel,
  stripLooseQuotes,
  unescapeQuoted,
  splitIncludeFlag,
} from './story-variables.js';

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
 * Like Story.defineMacro(), it throws if a declared parameter has no type.
 */
export function defineMacro(config) {
  checkParameterTypes(config.name, config.parameters ?? []);
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

/**
 * Validate the markup of a story's passages as Spindle does when the story
 * starts: malformed markup and unknown macros (checked against the built-in
 * macros and those registered with defineMacro), with passage, line and
 * column.
 */
export function validateMarkup(passages, options) {
  return validateStoryMarkup(passages, metadata.values(), options);
}

/**
 * The passages the markup of `source` names, with where each is written:
 * `[[…]]` links and the passage of `{goto}`, `{include}`, `{link}`,
 * `{watch}` and `{dialog}`, as the macros registered here declare them.
 * Malformed tags are skipped, so half-typed markup reads.
 */
export function collectPassageReferences(source) {
  return collectStoryPassageReferences(source, metadata.values());
}
