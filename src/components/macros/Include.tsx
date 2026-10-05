import { useStoryStore } from '../../store';
import { tokenize } from '../../markup/tokenizer';
import { buildAST } from '../../markup/ast';
import { NobrContext } from '../../markup/render';
import { defineMacro } from '../../define-macro';

const FLAG = 'inline';

/**
 * Split a standalone `inline` flag off the start or end of the include
 * arguments. The flag only counts outside quotes, brackets, parentheses and
 * braces, separated by whitespace from the target expression, so passage
 * names and expressions containing the word stay intact (#201).
 */
function parseIncludeArgs(rawArgs: string): {
  nameExpr: string;
  inline: boolean;
} {
  const trimmed = rawArgs.trim();

  // First and last whitespace runs at depth 0, as [start, end) offsets.
  let first: [number, number] | null = null;
  let last: [number, number] | null = null;
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') inString = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (depth === 0 && /\s/.test(ch)) {
      let end = i + 1;
      while (end < trimmed.length && /\s/.test(trimmed[end]!)) end++;
      last = [i, end];
      first ??= last;
      i = end - 1;
    }
  }

  // Next to a binary operator the word is an operand (`"a" + inline`).
  if (
    last &&
    last[1] === trimmed.length - FLAG.length &&
    trimmed.endsWith(FLAG)
  ) {
    const rest = trimmed.slice(0, last[0]);
    if (!/[-+*/%&|^!=<>?:,.]$/.test(rest))
      return { nameExpr: rest, inline: true };
  }
  if (first && first[0] === FLAG.length && trimmed.startsWith(FLAG)) {
    const rest = trimmed.slice(first[1]);
    if (!/^[-+*/%&|^=<>?:,.]/.test(rest))
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
