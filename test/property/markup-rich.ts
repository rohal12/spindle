/**
 * Arbitraries for rendered passages that mix markdown constructs with spindle
 * markup. Variable occurrences are emitted as sentinel characters so a test
 * can substitute the variables it wants (unique ones, or one shared `$x`).
 */
import { fc } from '@fast-check/vitest';

/** Stands for one variable occurrence in generated source. */
export const VAR_SENTINEL = '\u0001';

/** Inline HTML elements whose content must stay inline (render.tsx). */
export const INLINE_TAGS = [
  'span',
  'a',
  'strong',
  'em',
  'label',
  'b',
  'i',
  'code',
];

const join = (parts: string[]) => parts.join('');
const word = fc.stringMatching(/^[a-z]{1,5}$/);

/** Markdown punctuation that may or may not pair up into constructs. */
const noise = fc.constantFrom(
  '*',
  '**',
  '_',
  '`',
  '``',
  '~',
  '~~',
  '!',
  '#',
  '|',
  '-',
  '+',
  '1.',
  '&amp;',
  '&#123;',
  '(',
  ')',
  ']',
  '=',
  '"',
  "'",
  '}',
);

/**
 * Backslash escapes. Backslashes only come in pairs or before markdown
 * punctuation, so a backslash run before a variable is always even and the
 * variable stays live (odd runs are covered by the escape-rule property).
 */
const escape = fc.constantFrom(
  '\\*',
  '\\_',
  '\\`',
  '\\#',
  '\\\\',
  '\\|',
  '\\{',
  '\\}',
);

const variable = fc.constant(VAR_SENTINEL);

/** Code span content: no backtick run of the delimiter's length. */
function codeSpan(inner: fc.Arbitrary<string>) {
  return fc
    .tuple(fc.integer({ min: 1, max: 3 }), inner, fc.boolean())
    .filter(([n, body]) => {
      const runs = body.match(/`+/g) ?? [];
      return !runs.some((r) => r.length === n);
    })
    .map(([n, body, pad]) => {
      const fence = '`'.repeat(n);
      const sp = pad ? ' ' : '';
      return fence + sp + body + sp + fence;
    });
}

const codeContent = fc
  .array(
    fc.oneof(
      { weight: 3, arbitrary: word },
      { weight: 2, arbitrary: variable },
      fc.constantFrom(' ', '*', '_', '\\\\', '`', '[x]', '#', '&lt;'),
    ),
    { minLength: 1, maxLength: 6 },
  )
  .map(join);

/**
 * Text that may open a fenced code block when it starts a line. The info
 * string (`~~~a {$x}`) is not displayed, by CommonMark, so variables there
 * legitimately render nothing; such lines are not generated. Whether
 * ```` ```x` ```` opens a fence depends on backticks hidden inside spindle
 * elements, so any line starting with three backticks or tildes is skipped.
 */
function opensFence(s: string): boolean {
  return /^\s*(`{3}|~{3})/.test(s);
}

const tableCell = (inline: fc.Arbitrary<string>) =>
  inline.filter((s) => !s.includes('\n') && !s.includes('|'));

export interface RichOptions {
  /** Attribute added to generated inline HTML elements. */
  inlineAttr?: string;
  /** Attribute added to generated block HTML elements. */
  blockAttr?: string;
}

/**
 * Passages of markdown blocks (paragraphs, headings, blockquotes, lists,
 * fenced code, tables) and spindle markup (variables, macros, links, HTML),
 * nested to a bounded depth.
 */
export function richPassage(opts: RichOptions = {}) {
  const inlineAttr = opts.inlineAttr ? ` ${opts.inlineAttr}` : '';
  const blockAttr = opts.blockAttr ? ` ${opts.blockAttr}` : '';
  return fc
    .letrec<{
      inline: string;
      piece: string;
      blocks: string;
      block: string;
    }>((tie) => ({
      inline: fc
        .array(tie('piece'), {
          minLength: 1,
          maxLength: 6,
          depthIdentifier: 'inline',
        })
        .map(join)
        .filter((s) => !opensFence(s)),
      piece: fc.oneof(
        { depthSize: 'small', depthIdentifier: 'inline' },
        { weight: 4, arbitrary: word },
        { weight: 3, arbitrary: fc.constant(' ') },
        { weight: 4, arbitrary: variable },
        { weight: 2, arbitrary: noise },
        { weight: 2, arbitrary: escape },
        { weight: 2, arbitrary: codeSpan(codeContent) },
        { weight: 1, arbitrary: fc.constant('[[Start]]') },
        { weight: 1, arbitrary: fc.constant('{print "pr"}') },
        { weight: 1, arbitrary: fc.constant('<br>') },
        {
          weight: 1,
          arbitrary: fc
            .tuple(fc.constantFrom('*', '**', '_', '~~'), tie('inline'))
            .map(([d, body]) => d + body + d),
        },
        {
          weight: 1,
          arbitrary: tie('inline').map((label) => `[${label}](http://e.x/)`),
        },
        {
          weight: 2,
          arbitrary: fc
            .tuple(fc.constantFrom(...INLINE_TAGS), tie('inline'))
            .map(([tag, body]) => `<${tag}${inlineAttr}>${body}</${tag}>`),
        },
        {
          weight: 1,
          arbitrary: fc
            .tuple(fc.constantFrom('if true', 'span', 'nobr'), tie('inline'))
            .map(([open, body]) => `{${open}}${body}{/${open.split(' ')[0]}}`),
        },
      ),
      blocks: fc
        .array(
          fc.tuple(tie('block'), fc.constantFrom('\n', '\n\n', '\n\n\n')),
          { minLength: 1, maxLength: 4, depthIdentifier: 'blocks' },
        )
        .map((bs) => bs.map(([b, sep]) => b + sep).join('')),
      block: fc.oneof(
        { depthSize: 'small', depthIdentifier: 'blocks' },
        { weight: 4, arbitrary: tie('inline') },
        {
          weight: 1,
          arbitrary: fc
            .tuple(fc.integer({ min: 1, max: 3 }), tie('inline'))
            .map(([n, body]) => `${'#'.repeat(n)} ${body}`),
        },
        {
          weight: 1,
          arbitrary: tie('inline').map((body) => `> ${body}`),
        },
        {
          weight: 1,
          arbitrary: fc
            .tuple(
              fc.constantFrom('- ', '* ', '1. '),
              fc.array(tie('inline'), { minLength: 1, maxLength: 3 }),
            )
            .map(([marker, items]) =>
              items.map((it) => marker + it).join('\n'),
            ),
        },
        {
          weight: 1,
          arbitrary: fc
            .tuple(
              fc.constantFrom('```', '~~~', '````'),
              fc.array(
                codeContent.filter((c) => !c.includes('`')),
                { minLength: 1, maxLength: 3 },
              ),
            )
            .map(([fence, lines]) => `${fence}\n${lines.join('\n')}\n${fence}`),
        },
        {
          weight: 1,
          // A `|` in a cell starts another cell, and GFM drops cells beyond
          // the header's count (with their content), so cells have no pipes.
          arbitrary: fc
            .tuple(tableCell(tie('inline')), tableCell(tie('inline')))
            .map(([a, b]) => `| h1 | h2 |\n| --- | --- |\n| ${a} | ${b} |`),
        },
        {
          weight: 1,
          arbitrary: fc
            .tuple(
              fc.constantFrom('div', 'section', 'blockquote'),
              tie('blocks'),
            )
            .map(([tag, body]) => `<${tag}${blockAttr}>\n${body}\n</${tag}>`),
        },
        {
          weight: 1,
          arbitrary: fc
            .tuple(fc.constantFrom('if true', 'nobr'), tie('blocks'))
            .map(
              ([open, body]) => `{${open}}\n${body}{/${open.split(' ')[0]}}`,
            ),
        },
      ),
    }))
    .blocks.filter(
      // Adjacent brackets (`[` + `[label](url)`) can form a Twine link
      // whose text is literal by design (docs/markup.md "Links"), so a
      // variable inside it shows as `{$v}`. Only the explicit links are kept.
      (src) =>
        !src.replaceAll('[[Start]]', 'L').includes('[[') &&
        !macroInImageAlt(src),
    );
}

/**
 * Whether an image's alt text (`!` noise before `[label](url)`) contains a
 * macro. Alt text is an attribute, where macros have no text form and show
 * nothing (docs/markup.md "Links and images"), so variables inside them
 * legitimately don't render.
 */
function macroInImageAlt(src: string): boolean {
  for (let i = src.indexOf('!['); i !== -1; i = src.indexOf('![', i + 1)) {
    let depth = 0;
    for (let j = i + 1; j < src.length; j++) {
      if (src[j] === '[') depth++;
      else if (src[j] === ']' && --depth === 0) {
        if (/\{(if|span|nobr)\b/.test(src.slice(i, j))) return true;
        break;
      }
    }
  }
  return false;
}

/** Replace each sentinel with `name(k)` for its occurrence index k. */
export function substituteVars(
  src: string,
  name: (k: number) => string,
): { src: string; count: number } {
  let k = 0;
  const out = src.replace(new RegExp(VAR_SENTINEL, 'g'), () => name(k++));
  return { src: out, count: k };
}
