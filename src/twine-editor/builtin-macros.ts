import '../macros/register-builtins';
import { getMacroRegistry, type MacroMetadata } from '../registry';

/**
 * The built-in macros, computed as `scripts/dump-macro-registry.ts` does:
 * what `getMacroRegistry()` returns once register-builtins has run. The
 * hydrate build replaces this module with the generated
 * `dist/pkg/macro-registry.js`, so the bundle carries no Preact. Every
 * file under `src/twine-editor/` gets the built-in macros from here only.
 */
export const builtinMacros: readonly MacroMetadata[] = getMacroRegistry();
