import { micromark } from 'micromark';
import type {
  Code,
  Construct,
  Extension,
  Options,
  Resolver,
} from 'micromark-util-types';
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
 * `unclosedHtml` and `textData`).
 */
export function markdownToHtml(
  text: string,
  options?: { inline?: boolean },
): string {
  const base = markdownOptions(options);
  return micromark(text, {
    ...base,
    extensions: [...(base.extensions ?? []), unclosedHtml(text), textData],
  });
}

/** Join a data token just read to a data token right before it. */
const joinData: Resolver = (events) => {
  const at = events.length - 2;
  const before = events[at - 1];
  if (before && before[0] === 'exit' && before[1].type === 'data') {
    before[1].end = events[at]![1].end;
    events.length = at;
  }
  return events;
};

/**
 * Text that no construct takes, read as data joined to the data before it.
 *
 * Where every text construct fails at a character (a `!` without `[`, a `]`
 * without a label, a `\` before a letter, an unclosed `<!--`), micromark
 * reads it, on to the next character a construct may start at, as a new data
 * token. Runs of data tokens are joined only after the paragraph is read,
 * each run by splicing the paragraph's whole list of events: time quadratic
 * in the number of runs where other tokens part them (`\]a!` repeated: an
 * escape, data `a`, data `!`), and erratically so, as the cost of moving
 * the list's elements depends on where the garbage collector keeps it.
 *
 * Tried where micromark's text tries constructs, after all of them (as a
 * construct of every character), this reads that data as micromark would
 * and joins it to the data before it at once, at the end of the list.
 */
const textData: Extension = {
  text: {
    null: {
      name: 'textData',
      tokenize(effects, ok) {
        const self = this;
        const constructs = this.parser.constructs.text;

        /** Whether a construct may start at `code`, as micromark's text asks. */
        function atBreak(code: Code): boolean {
          if (code === null) return true;
          const list = constructs[code] ?? [];
          return (Array.isArray(list) ? list : [list]).some(
            (item) => !item.previous || item.previous.call(self, self.previous),
          );
        }

        function data(code: Code) {
          if (atBreak(code)) {
            effects.exit('data');
            return ok(code);
          }
          effects.consume(code);
          return data;
        }

        return (code) => {
          effects.enter('data');
          effects.consume(code);
          return data;
        };
      },
      resolveTo: joinData,
    },
  },
};

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
    resolveTo: joinData,
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
