import { isSigil } from './tokens';
import { defaultCodeEnd } from './code-end';

/**
 * Attributes whose value is code with braces of its own, not text: event
 * handlers (`on…`, JavaScript), `pattern` (a regular expression, as in
 * `\p{L}{2,3}`) and `srcdoc` (an HTML document, with its own scripts and
 * styles). Their braces are code, so they are not read as markup: only
 * sigil references (`{$x}`, `{_x}`, `{@x}`, `{%x}` and expressions starting
 * with one) are resolved, and any other `{` is literal.
 */
export function isCodeAttribute(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('on') || lower === 'pattern' || lower === 'srcdoc';
}

/** Literal text, the source of one `{…}` reference (without braces), or a
 * `{…}` block that is kept exactly as written. */
export type SigilPart =
  | { text: string }
  | { expr: string }
  | { verbatim: string };

/**
 * Split a code attribute value into literal text and its `{…}` blocks that
 * start with a sigil. Braces inside strings don't close a block; an
 * unclosed block, any other brace and backslashes are text. A block whose
 * sigil is not followed by a word character (`{$(…)}`) is code, kept
 * verbatim: not resolved, and not decoded like text.
 */
export function splitSigilTemplate(template: string): SigilPart[] {
  const parts: SigilPart[] = [];
  let text = '';
  let i = 0;

  while (i < template.length) {
    const brace = template.indexOf('{', i);
    if (brace === -1) {
      text += template.slice(i);
      break;
    }
    text += template.slice(i, brace);
    i = brace + 1;
    const end = isSigil(template[i])
      ? defaultCodeEnd.closeBrace(template, i, i)
      : -1;
    if (end === -1) {
      text += '{';
      continue;
    }
    if (text) parts.push({ text });
    text = '';
    const block = template.slice(i, end);
    parts.push(
      /^.\w/.test(block) ? { expr: block } : { verbatim: `{${block}}` },
    );
    i = end + 1;
  }

  if (text) parts.push({ text });
  return parts;
}
