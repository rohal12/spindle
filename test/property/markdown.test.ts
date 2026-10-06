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
import { expectAboutLinear } from '../support/linear-time';

/** micromark with spindle's extensions, as it renders on its own. */
function reference(text: string, inline: boolean): string {
  return micromark(text, markdownOptions({ inline }));
}

/**
 * Markdown around raw HTML openers and closers: comments (`<!-->` and
 * `<!--->` are complete ones), processing instructions, CDATA sections and
 * declarations, closed or not, in paragraphs, code spans and fences,
 * blockquotes, lists and tables, after line endings of any kind and tabs,
 * among characters that may or may not start a construct (`!`, `&`, `\`).
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
            ...['!', '&', '&amp;', '&#', '~', '\\a', '\\]'],
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
   * their number. And text that no construct takes, between other tokens
   * (`\]a!`: an escape, then `a` and `!` as data). micromark joins each run
   * of data by splicing the paragraph's whole list of events: quadratic time
   * in the number of runs. (Emphasis delimiters are left out: micromark
   * resolves many of them in one paragraph in quadratic time, `*a*` and `**a`
   * alike. So are many `]` after other tokens, `&amp;]`: micromark looks for
   * each one's label start back through all the paragraph's tokens.)
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
    '\\]a!',
    '&amp;a&',
    ']<!--',
  ];

  /** 8× the input may take about 8× the time, not a quadratic scan's 64×. */
  function expectLinear(small: string, large: string): void {
    expectAboutLinear(
      () => markdownToHtml(small),
      () => markdownToHtml(large),
    );
  }

  it.each(PATTERNS)('stays about linear on %j repeated', (pattern) => {
    expectLinear(pattern.repeat(500), pattern.repeat(4000));
  });

  // micromark's offsets skip a byte order mark and container markers, and
  // count CRLF as two: openers are still found where they are.
  it.each(['﻿', 'x\r\n> ', '\t- ', '> > '])(
    'stays about linear after %j',
    (prefix) => {
      expectLinear(prefix + 'a<!--'.repeat(500), prefix + 'a<!--'.repeat(4000));
    },
  );
});
