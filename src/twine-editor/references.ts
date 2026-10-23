import { passagePiecesOfTokens } from '../tooling';
import { tokenizeMarkupTolerant } from '../markup/parse';
import { builtinMacros } from './builtin-macros';

/**
 * The names of the passages `text` names with macros (`{goto}`, `{include}`,
 * `{link}`, `{dialog}`, `{watch}` and the like), once each, in source order:
 * what Twine draws as connections. `[[…]]` links are left out, Twine reads
 * those itself, as are names that are expressions. Half-typed markup is read
 * as far as it goes, and anything that cannot be read gives no references.
 */
export function parsePassageText(text: string): string[] {
  try {
    // Both `[[…]]` and `{link}` report `macro: 'link'`; only the link token
    // tells them apart.
    const tokens = tokenizeMarkupTolerant(text).tokens;
    const bracketTargets = new Set(
      tokens
        .filter((token) => token.type === 'link')
        .map((link) => link.targetStart),
    );
    const names = new Set<string>();
    for (const piece of passagePiecesOfTokens(text, builtinMacros, tokens)) {
      if (piece.kind !== 'passage' || bracketTargets.has(piece.offset))
        continue;
      names.add(piece.name);
    }
    return [...names];
  } catch {
    return [];
  }
}
