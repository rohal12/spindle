import { useStoryStore } from '../../store';
import { tokenize } from '../../markup/tokenizer';
import { buildAST } from '../../markup/ast';
import { NobrContext } from '../../markup/render';
import { defineMacro } from '../../define-macro';
import { endsWithOperator, isWhitespace, topLevelIndices } from './arg-utils';

const FLAG = 'inline';

/**
 * Split a standalone `inline` flag off the start or end of the include
 * arguments. The flag only counts outside quotes, brackets, parentheses and
 * braces, separated by whitespace from the target expression, so passage
 * names and expressions containing the word stay intact (#201).
 */
export function parseIncludeArgs(rawArgs: string): {
  nameExpr: string;
  inline: boolean;
} {
  const trimmed = rawArgs.trim();

  // First and last whitespace runs at depth 0, as [start, end) offsets.
  const spaces = topLevelIndices(trimmed, isWhitespace);
  let first: [number, number] | null = null;
  let last: [number, number] | null = null;
  if (spaces.length > 0) {
    let s = 0;
    while (s + 1 < spaces.length && spaces[s + 1] === spaces[s]! + 1) s++;
    first = [spaces[0]!, spaces[s]! + 1];
    let e = spaces.length - 1;
    while (e > 0 && spaces[e - 1] === spaces[e]! - 1) e--;
    last = [spaces[e]!, spaces[spaces.length - 1]! + 1];
  }

  // Next to a binary operator the word is an operand (`"a" + inline`);
  // the closing `/` of a regex literal is not one.
  if (
    last &&
    last[1] === trimmed.length - FLAG.length &&
    trimmed.endsWith(FLAG)
  ) {
    const rest = trimmed.slice(0, last[0]);
    if (!endsWithOperator(rest)) return { nameExpr: rest, inline: true };
  }
  if (first && first[0] === FLAG.length && trimmed.startsWith(FLAG)) {
    const rest = trimmed.slice(first[1]);
    // `inline %name` reads a transient variable; `inline % 2` is modulo.
    if (!/^(?:[-+*/&|^=<>?:,.]|%(?![A-Za-z_]))/.test(rest))
      return { nameExpr: rest, inline: true };
  }
  return { nameExpr: trimmed, inline: false };
}

defineMacro({
  name: 'include',
  interpolate: true,
  merged: true,
  render({ rawArgs }, ctx) {
    const storyData = useStoryStore((s) => s.storyData);

    const { nameExpr, inline } = parseIncludeArgs(rawArgs);

    let passageName: string;
    try {
      const result = ctx.evaluate!(nameExpr);
      passageName = String(result);
    } catch {
      passageName = nameExpr.replace(/^["']|["']$/g, '');
    }

    const passage = storyData?.passages.get(passageName);
    // Parse once per included passage: the renderer keys children by AST
    // node identity, so a fresh AST is what remounts the content when the
    // included passage changes, while re-renders of the same passage keep
    // its macros mounted (#175).
    const ast = ctx.hooks.useMemo(
      () => (passage ? buildAST(tokenize(passage.content)) : null),
      [passage],
    );

    if (!storyData) return null;

    if (passage) {
      useStoryStore.getState().trackRender(passageName);
    }
    if (!passage || !ast) {
      return (
        <span class="error">{`{include${ctx.sourceLocation()}: passage "${passageName}" not found}`}</span>
      );
    }

    const nobr = passage.tags.includes('nobr');
    const content = inline
      ? ctx.renderInlineNodes(ast)
      : ctx.renderNodes(ast, nobr ? { nobr: true } : undefined);

    if (nobr) {
      return ctx.wrap(ctx.h(NobrContext.Provider, { value: true }, content));
    }
    return ctx.wrap(content);
  },
});
