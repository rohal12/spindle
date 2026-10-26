// @vitest-environment happy-dom
/**
 * Format must not change what the story displays: a passage renders the
 * same before and after formatPassage, for HTML with prose in it.
 */
import { describe, it, expect } from 'vitest';
import { render } from 'preact';
import * as prettier from 'prettier';
import { parseMarkup } from '../../src/markup/parse';
import { renderNodes } from '../../src/markup/render';
import { formatPassage } from '../../src/format/format-passage';

/** Elements whose surrounding whitespace does not render (display: block and kin). */
const BLOCK = new Set(
  'address article aside blockquote details dialog dd div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section summary table tbody td tfoot th thead tr ul'.split(
    ' ',
  ),
);
/** Elements whose text renders as written. */
const PREFORMATTED = new Set(['pre', 'textarea']);

/**
 * What the browser shows of `node`: its elements and attributes, and its
 * text with whitespace collapsed as CSS collapses it (kept as written in
 * preformatted elements, dropped next to block boundaries).
 */
function displayed(node: Node, preformatted = false): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    // Preformatted whitespace is kept out of the collapsing below
    return preformatted
      ? text.replace(/ /g, '\u0002').replace(/\n/g, '\u0003')
      : text.replace(/\s+/g, ' ');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const element = node as Element;
  const tag = element.localName;
  const pre = preformatted || PREFORMATTED.has(tag);
  const attributes = Array.from(element.attributes)
    .map((a) => ` ${a.name}="${a.value}"`)
    .join('');
  const inner = Array.from(element.childNodes)
    .map((child) => displayed(child, pre))
    .join('');
  const block = BLOCK.has(tag) ? '\u0001' : '';
  return `${block}<${tag}${attributes}>${block}${inner}${block}</${tag}>${block}`;
}

function canonical(markup: string): string {
  const container = document.createElement('div');
  render(<>{renderNodes(parseMarkup(markup))}</>, container);
  return (
    Array.from(container.childNodes)
      .map((child) => `\u0001${displayed(child)}\u0001`)
      .join('')
      // Adjacent text nodes collapse together
      .replace(/ {2,}/g, ' ')
      // Whitespace at a block boundary does not render
      .replace(/ *\u0001+ */g, '|')
      .replace(/\u0002/g, ' ')
      .replace(/\u0003/g, '\n')
  );
}

const cases = [
  '<div>\nLine one\n\nLine two\n</div>\n',
  '<div>\n  a  \n  b\n</div>\n',
  '<div>\na\\\nb\n</div>\n',
  '<section>\n<div>\na <em>word</em>\n\nb\n</div>\n</section>\n',
  '<div>\n# Heading\n\n- first\n- second\n</div>\n',
  '<div>\na\n\n{if true}b\n\nc{/if}\n</div>\n',
  '<div>\n<b>bold</b>, and more!\n</div>\n',
  '<div>\nHello <em>you</em>.\n</div>\n',
  '<p>\nHello <em>you</em>.\n</p>\n',
  '<div>\n<span class="a">one</span><span class="b">two</span>\n</div>\n',
  '<div>\n<p>First <strong>para</strong>.</p>\n<p>Second, <a href="#x">link</a>!</p>\n</div>\n',
  '<ul>\n<li><b>a</b>: first</li>\n<li>second <i>item</i>.</li>\n</ul>\n',
  '<div>\n<pre>a\n  b</pre>\n</div>\n',
  '<div class="box">\nSome *markdown* and <code>code</code>, then text.\n</div>\n',
  '<section>\n<h2>Title</h2>\n<p>The <abbr title="x">abbr</abbr>; more.</p>\n</section>\n',
  '<div>\n<span>{$name}</span>, welcome!\n</div>\n',
  '<div>\n<textarea>a\n  b</textarea>\n</div>\n',
  '<div>\n<div style="white-space: pre">  keep\n   this</div>\n</div>\n',
  '<div class="long">\nA long line of prose with <b>bold words</b>, <i>italic words</i> and <a href="#somewhere">a link somewhere</a>, then more prose to pass eighty columns.\n</div>\n',
  '<div>\n<span>a</span>\n<span>b</span>\n</div>\n',
  '<div>\n  <p>\n    Indented <em>text</em>\n    over lines.\n  </p>\n</div>\n',
];

const literalCases = [
  '<pre>\na    \n b\n</pre>\n',
  '<textarea>\na    \n b\n</textarea>\n',
  '<pre><span>hello</span>\n\t literal    \n</pre>\n',
  'Before <pre><span>hello</span>\n\t literal    \n</pre> after\n',
  '- <pre><span>hello</span>\n  literal    \n  </pre>\n  continuation\n',
  '{if true}\n  - <pre>text</pre>\n    continuation\n{/if}\n',
  '<pre>\tlong literal source text    </pre>\n',
  '```python\nprint("hello world from the story")\n```\n',
  '```\n\tline\t  \n \t\n```\n',
  '```html\n<div>\n<span>a    </span>\n</div>\n```\n',
  '````\n```\n\tcode    \n~~~\n````\n',
  '- item\n\n  ```\n  \tcode    \n  ```\n',
  '```\ncode    \n\n',
];

const markdownCases = [
  '## A very long heading containing many different words\n',
  'A very long setext heading containing many different words\n==========================================================\n',
  '| one long cell | two long cell |\n| --- | --- |\n| third text here | fourth cell here |\n',
  'one long cell | two long cell\n--- | ---\nthird text here | fourth cell here\n',
  '- A very long list item containing many different words\n  - A nested list item containing many different words\n',
  '> A very long blockquote containing many different words\n>\n> Second paragraph in the same blockquote\n',
  'A paragraph with `many words inside an inline code span` after it.\n',
  'A paragraph with [many words in a Markdown link](https://example.com "A long title") after it.\n',
  'A paragraph with ![many words in an image label](image.png "A long title") after it.\n',
  '[long-reference]: https://example.com/a-long-url "A long reference title"\n\n[reference][long-reference]\n',
  '{if true}\n## A long heading inside a macro body\n\n| one long cell | two long cell |\n| --- | --- |\n| third text here | fourth cell here |\n{/if}\n',
];

describe('Format keeps what a passage displays', () => {
  it.each([
    '# Heading',
    '> quoted',
    '- item',
    '+ item',
    '* item',
    '1. item',
    '1) item',
    '---',
    '***',
    '===',
    '```code',
    '~~~code',
    '[ref]: /url',
  ])(
    'does not turn inline %s into a Markdown block (#592)',
    async (punctuation) => {
      for (const maxLineLength of [10, 80]) {
        const prefix =
          maxLineLength === 10
            ? 'Some words'
            : 'Some words ' + 'ordinary prose '.repeat(5);
        const source = `${prefix} ${punctuation} and more words at the end.`;
        const options = { maxLineLength };
        const output = await formatPassage(source, options);
        expect(canonical(output)).toBe(canonical(source));
        expect(await formatPassage(output, options)).toBe(output);
      }
    },
  );

  for (const input of [...cases, ...literalCases]) {
    it(JSON.stringify(input), async () => {
      const options = {
        prettier,
        maxLineLength: literalCases.includes(input) ? 20 : undefined,
      };
      const output = await formatPassage(input, options);
      expect(canonical(output)).toBe(canonical(input));
      expect(await formatPassage(output, options)).toBe(output);
    });
  }

  for (const input of markdownCases) {
    it(`keeps Markdown structure when wrapping: ${JSON.stringify(input)}`, async () => {
      for (const maxLineLength of [18, 80]) {
        const options = { maxLineLength };
        const source =
          maxLineLength === 80
            ? input.replace(/long/g, 'very '.repeat(25))
            : input;
        const output = await formatPassage(source, options);
        expect(canonical(output)).toBe(canonical(source));
        expect(await formatPassage(output, options)).toBe(output);
      }
    });
  }
});
