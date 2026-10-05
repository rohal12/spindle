import { micromark } from 'micromark';
import type { Construct, Extension, Options } from 'micromark-util-types';
import { gfmTable, gfmTableHtml } from 'micromark-extension-gfm-table';
import {
  gfmStrikethrough,
  gfmStrikethroughHtml,
} from 'micromark-extension-gfm-strikethrough';

/**
 * micromark options for spindle's markdown: CommonMark with GFM tables and
 * strikethrough, raw HTML passed through, and no indented code.
 *
 * When `inline` is true, block-level constructs (lists, headings, blockquotes,
 * thematic breaks, fenced code, tables) are disabled.  This is used when
 * rendering content inside inline HTML elements like `<span>` where
 * block-level output is invalid. Fences then read as code spans.
 */
export function markdownOptions(options?: { inline?: boolean }): Options {
  const disabled: string[] = ['codeIndented'];
  if (options?.inline) {
    disabled.push(
      'list',
      'headingAtx',
      'setextUnderline',
      'thematicBreak',
      'blockQuote',
      'codeFenced',
      'table',
    );
  }
  return {
    allowDangerousHtml: true,
    extensions: [
      gfmTable(),
      gfmStrikethrough(),
      { disable: { null: disabled } },
    ],
    htmlExtensions: [gfmTableHtml(), gfmStrikethroughHtml()],
  };
}

/**
 * Parse a text string as CommonMark markdown and return an HTML string, as
 * micromark does with `markdownOptions`, but in about linear time (see
 * `unclosedHtml`).
 */
export function markdownToHtml(
  text: string,
  options?: { inline?: boolean },
): string {
  const base = markdownOptions(options);
  return micromark(text, {
    ...base,
    extensions: [...(base.extensions ?? []), unclosedHtml(text)],
  });
}

/** Characters of an email autolink's local part (micromark's `asciiAtext`). */
const ATEXT = /[#-'*+\--9=?A-Z^-~]/;
const ALPHANUMERIC = /[0-9A-Za-z]/;
const ALPHA = /[A-Za-z]/;

/**
 * Inline raw HTML that can't be closed in `text`, read as the text it is.
 *
 * At a `<` opening a comment (`<!--`), a processing instruction (`<?`), a
 * CDATA section (`<![CDATA[`) or a declaration (`<!` and a letter), micromark
 * reads on for the closer (`-->`, `?>`, `]]>`, `>`) to the end of the
 * paragraph, and without one the `<` is text. Many such openers took time
 * quadratic in their number. Where no closer comes later in the whole text,
 * this construct, tried at each `<` before micromark's own, takes the `<`
 * as text at once, as micromark would end up doing.
 *
 * It is tried exactly where micromark tries raw HTML: not in code, link
 * destinations or HTML blocks (which start at a line start and run to their
 * end condition or the end of the document), whose output stays micromark's.
 * A `<?` may begin an email autolink (`<?a@b.c>`, tried before raw HTML),
 * which it then leaves to micromark.
 */
function unclosedHtml(text: string): Extension {
  // micromark drops a byte order mark, which offsets don't count
  const shift = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const comment = text.lastIndexOf('-->');
  const instruction = text.lastIndexOf('?>');
  const cdata = text.lastIndexOf(']]>');
  const declaration = text.lastIndexOf('>');

  /** Whether the raw HTML opening at `p` can't be closed. */
  function unclosed(p: number): boolean {
    if (text[p] !== '<') return false;
    // A comment closes with a `-->` from just past `<!`: `<!-->` is one
    if (text.startsWith('<!--', p)) return comment < p + 2;
    if (text.startsWith('<![CDATA[', p)) return cdata < p + 9;
    if (text[p + 1] === '!' && ALPHA.test(text[p + 2] ?? '')) {
      return declaration < p + 3;
    }
    if (text[p + 1] === '?') return instruction < p + 2 && !emailAutolink(p);
    return false;
  }

  /** Whether an email autolink opens at `p`, as micromark reads one. */
  function emailAutolink(p: number): boolean {
    let i = p + 1;
    while (ATEXT.test(text[i] ?? '')) i++;
    if (text[i] !== '@') return false;
    i++;
    let size = 0;
    let state: 'atSignOrDot' | 'label' | 'value' = 'atSignOrDot';
    for (;;) {
      const c = text[i] ?? '';
      if (state === 'atSignOrDot') {
        if (!ALPHANUMERIC.test(c)) return false;
        state = 'label';
      } else if (state === 'label') {
        if (c === '>') return true;
        if (c === '.') {
          i++;
          size = 0;
          state = 'atSignOrDot';
        } else {
          state = 'value';
        }
      } else {
        if (!((c === '-' || ALPHANUMERIC.test(c)) && size++ < 63)) {
          return false;
        }
        i++;
        state = c === '-' ? 'value' : 'label';
      }
    }
  }

  const construct: Construct = {
    name: 'unclosedHtml',
    tokenize(effects, ok, nok) {
      const at = this.now().offset + shift;
      return (code) => {
        if (code !== 60 || !unclosed(at)) return nok(code);
        effects.enter('data');
        effects.consume(code);
        effects.exit('data');
        return ok;
      };
    },
  };
  return { text: { 60: construct } };
}
