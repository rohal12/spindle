/**
 * Properties of spindle's markdown pipeline (`src/markup/markdown.ts`): it
 * renders exactly as micromark does with spindle's extensions, and in about
 * linear time.
 */
import { describe, expect, it } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { micromark } from 'micromark';
import { markdownOptions, markdownToHtml } from '../../src/markup/markdown';
import { fcOptions } from './config';

/** micromark with spindle's extensions, as it renders on its own. */
function reference(text: string, inline: boolean): string {
  return micromark(text, markdownOptions({ inline }));
}

/**
 * Markdown around raw HTML openers and closers: comments (`<!-->` and
 * `<!--->` are complete ones), processing instructions, CDATA sections and
 * declarations, closed or not, in paragraphs, code spans and fences,
 * blockquotes, lists and tables, after line endings of any kind and tabs.
 */
const htmlNoise = fc
  .tuple(
    fc.constantFrom('', '﻿'),
    fc.array(
      fc.oneof(
        {
          weight: 4,
          arbitrary: fc.constantFrom(
            ...['<!--', '<!-->', '<!--->', '<!-', '<!', '<?', '<?>'],
            ...['<![CDATA[', '<![CDAT', '<!A', '<!doctype x', '<?x@y.z>'],
            ...['<?a@b', '<?a@b.c', '<!--a@b.c>', '<a>', '</a>', '<div>'],
          ),
        },
        {
          weight: 3,
          arbitrary: fc.constantFrom(
            ...['-->', '--!>', '--', '-', '?>', '?', ']]>', ']]', ']', '>'],
            ...['@', '.', 'x', 'a b', '\\<', '&lt;', '\\'],
          ),
        },
        {
          weight: 3,
          arbitrary: fc.constantFrom(
            ...[' ', '  ', '\t', '\n', '\n\n', '\r\n', '\r', '  \n'],
            ...['> ', '- ', '1. ', '    ', '* ', '# '],
            ...['`', '``', '\n```\n', '\n~~~\n', '*', '_', '~~'],
            ...['[', '](u)', '[a](', ' "t', '![', '|', '\n| --- |\n'],
          ),
        },
      ),
      { maxLength: 30 },
    ),
  )
  .map(([bom, parts]) => bom + parts.join(''));

describe('markdownToHtml', () => {
  test.prop([htmlNoise, fc.boolean()], fcOptions)(
    'renders raw HTML openers exactly as micromark does',
    (text, inline) => {
      expect(markdownToHtml(text, { inline })).toBe(reference(text, inline));
    },
  );

  test.prop(
    [
      fc
        .tuple(htmlNoise, fc.integer({ min: 2, max: 6 }))
        .map(([unit, n]) => unit.repeat(n)),
      fc.boolean(),
    ],
    fcOptions,
  )('renders repeated openers exactly as micromark does', (text, inline) => {
    expect(markdownToHtml(text, { inline })).toBe(reference(text, inline));
  });
});

describe('markdownToHtml running time', () => {
  /**
   * Raw HTML openers that never close. micromark reads on from each one
   * looking for its closer, to the end of the paragraph: quadratic time in
   * their number. (Emphasis delimiters are left out: micromark resolves many
   * of them in one paragraph in quadratic time, `*a*` and `**a` alike.)
   */
  const PATTERNS = [
    'a<!--',
    '<!--',
    '\\*<!--',
    '\\]&amp;<!--',
    'a<!--x',
    'a<?',
    'a<?a@',
    'a<![CDATA[',
    'a<!A',
    '> a<!--\n',
    '- a<? b\n',
    '| a<!-- |\n',
  ];

  /** Milliseconds to render `src`, best of five. */
  function time(src: string): number {
    let best = Infinity;
    for (let run = 0; run < 5; run++) {
      const t0 = performance.now();
      markdownToHtml(src);
      best = Math.min(best, performance.now() - t0);
    }
    return best;
  }

  it.each(PATTERNS)('stays about linear on %j repeated', (pattern) => {
    const small = time(pattern.repeat(500));
    const large = time(pattern.repeat(4000));
    // 8× the input may take 8× the time; allow generous noise, but not the
    // 64× of a quadratic scan.
    expect(large).toBeLessThan(Math.max(small, 0.5) * 24);
  });

  // micromark's offsets skip a byte order mark and container markers, and
  // count CRLF as two: openers are still found where they are.
  it.each(['﻿', 'x\r\n> ', '\t- ', '> > '])(
    'stays about linear after %j',
    (prefix) => {
      const small = time(prefix + 'a<!--'.repeat(500));
      const large = time(prefix + 'a<!--'.repeat(4000));
      expect(large).toBeLessThan(Math.max(small, 0.5) * 24);
    },
  );
});
