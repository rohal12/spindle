/**
 * Formatting preserves runtime macro payloads, and keeps the passage's
 * line-ending style.
 */
import { describe, expect, it } from 'vitest';
import * as prettier from 'prettier';
import { formatPassage } from '../../src/format/format-passage';
import { tokenizeMarkupTolerant } from '../../src/markup/parse';

const fmt = (body: string) => formatPassage(body, { prettier });

/** The compiler normalizes CRLF to LF before tokenizing; so does this view. */
function runtimeMacroArgs(text: string) {
  return tokenizeMarkupTolerant(text.replace(/\r\n/g, '\n'))
    .tokens.filter((t) => t.type === 'macro')
    .map((t) => t.rawArgs);
}

describe('formatting preserves runtime macro payloads', () => {
  for (const newline of ['\n', '\r\n']) {
    it(`multiline template in HTML (${newline.length})`, async () => {
      const text = '<div>\n<span>{print `a\nb`}</span>\n</div>'.replace(
        /\n/g,
        newline,
      );
      const output = await fmt(text);
      expect(runtimeMacroArgs(output)).toEqual(runtimeMacroArgs(text));
      if (newline === '\r\n') {
        expect(output.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
      }
      expect(await fmt(output)).toBe(output);
    });
  }

  it('single-line HTML macro remains intact and idempotent', async () => {
    const text = '<div><span>{print "a b"}</span></div>';
    const output = await fmt(text);
    expect(runtimeMacroArgs(output)).toEqual(runtimeMacroArgs(text));
    expect(await fmt(output)).toBe(output);
  });

  for (const newline of ['\n', '\r\n']) {
    it(`nested braces, quotes and sibling elements (${newline.length})`, async () => {
      const text = [
        '<div>',
        '<p>before</p>',
        '<span>{print `x ${ {a: 1}.a }',
        '  y   z`}</span>',
        '<span>{print "one   two"}</span>',
        '<span>{if true}{print `p',
        'q`}{/if}</span>',
        '</div>',
      ].join(newline);
      const output = await fmt(text);
      expect(runtimeMacroArgs(output)).toEqual(runtimeMacroArgs(text));
      if (newline === '\r\n') {
        expect(output.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
      }
      expect(await fmt(output)).toBe(output);
    });
  }

  it('a stand-in lookalike in the source is not expanded', async () => {
    const text =
      '<div>\n<span>{SPML0}</span>\n<span>{print `a\nb`}</span>\n</div>';
    const output = await fmt(text);
    expect(output).toContain('{SPML0}');
    expect(runtimeMacroArgs(output)).toEqual(runtimeMacroArgs(text));
  });
});
