import { collectStoryPassageReferences } from '../tooling';
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
    const links = tokenizeMarkupTolerant(text).tokens.filter(
      (token) => token.type === 'link',
    );
    const names = new Set<string>();
    for (const ref of collectStoryPassageReferences(text, builtinMacros)) {
      if (ref.target.kind !== 'name') continue;
      if (
        links.some(
          (link) => ref.start >= link.targetStart && ref.start < link.targetEnd,
        )
      )
        continue;
      names.add(ref.target.name);
    }
    return [...names];
  } catch {
    return [];
  }
}
