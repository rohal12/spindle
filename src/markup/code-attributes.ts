import { isSigil } from './tokens';
import { indexCodeEnds } from './code-end';
import { lexJs } from '../js-lexer';

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
  { text: string } | { expr: string } | { verbatim: string };

/**
 * Split a code attribute value into literal text and its `{…}` blocks that
 * start with a sigil. Braces inside strings don't close a block; an
 * unclosed block, any other brace and backslashes are text. A block whose
 * sigil is not followed by an identifier (`{$(…)}`) is code, kept
 * verbatim: not resolved, and not decoded like text.
 */
export function splitSigilTemplate(
  template: string,
  incomplete = false,
): SigilPart[] {
  const parts: SigilPart[] = [];
  let text = '';
  let i = 0;
  const closeBrace = indexCodeEnds(template);

  while (i < template.length) {
    const brace = template.indexOf('{', i);
    if (brace === -1) {
      text += template.slice(i);
      break;
    }
    text += template.slice(i, brace);
    i = brace + 1;
    let end = isSigil(template[i]) ? closeBrace(i) : -1;
    if (end === -1 && incomplete && isSigil(template[i])) end = template.length;
    if (end === -1) {
      text += '{';
      continue;
    }
    if (text) parts.push({ text });
    text = '';
    const block = template.slice(i, end);
    let reference = /^.\w/.test(block);
    if (!reference && block[1] === '\\') {
      lexJs(block, {
        variable(_sigil, _name, start) {
          if (start === 0) reference = true;
        },
      });
    }
    parts.push(
      reference || (incomplete && block.length === 1 && end === template.length)
        ? { expr: block }
        : { verbatim: `{${block}}` },
    );
    i = end + 1;
  }

  if (text) parts.push({ text });
  return parts;
}
