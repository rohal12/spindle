/**
 * Formatting keeps the JavaScript values a {do} body produces. A template
 * literal (or a backslash-continued string) that spans lines is a value, so
 * its line breaks and the whitespace after them stay.
 */
import { describe, expect, it } from 'vitest';
import * as prettier from 'prettier';
import { formatPassage } from '../../src/format/format-passage';

const fmt = (body: string) => formatPassage(body, { prettier });

describe('multiline JavaScript literals in {do} bodies', () => {
  it('a template literal keeps its second line', async () => {
    const text = '{do}\nconst value = `a\nb`;\n{/do}\n';
    expect(await fmt(text)).toBe('{do}\n  const value = `a\nb`;\n{/do}\n');
  });

  it('is the same with CRLF', async () => {
    const text = '{do}\r\nconst value = `a\r\n  b   \r\n`;\r\n{/do}\r\n';
    const output = await fmt(text);
    expect(output).toBe(
      '{do}\r\n  const value = `a\r\n  b   \r\n`;\r\n{/do}\r\n',
    );
    expect(await fmt(output)).toBe(output);
  });

  it('keeps an inline do body, a continued string and a nested template', async () => {
    const inline = '{if $v}\n{do}x(`a\n   b`);{/do}\n{/if}\n';
    expect(await fmt(inline)).toBe(
      '{if $v}\n  {do}x(`a\n   b`);{/do}\n{/if}\n',
    );
    const continued = '{do}\nx("a\\\n   b");\n{/do}\n';
    expect(await fmt(continued)).toBe('{do}\n  x("a\\\n   b");\n{/do}\n');
    const nested = '{do}\nx(`${ `p\n  q` }\n  r`);\n{/do}\n';
    expect(await fmt(nested)).toBe('{do}\n  x(`${ `p\n  q` }\n  r`);\n{/do}\n');
  });

  it('is not fooled by backticks and quotes in comments', async () => {
    const text = "{do}\n// it's `x\nfoo();\n   bar();\n{/do}\n";
    expect(await fmt(text)).toBe(
      "{do}\n  // it's `x\n  foo();\n  bar();\n{/do}\n",
    );
  });

  it('a regex literal holding a backtick does not open a template', async () => {
    const text = '{do}\nconst re = /`/;\nconst value = `a\nb`;\n{/do}\n';
    const expected =
      '{do}\n  const re = /`/;\n  const value = `a\nb`;\n{/do}\n';
    const output = await fmt(text);
    expect(output).toBe(expected);
    expect(await fmt(output)).toBe(output);
    const crlf = await fmt(text.replace(/\n/g, '\r\n'));
    expect(crlf).toBe(expected.replace(/\n/g, '\r\n'));
  });

  it('recognizes regex literals by lexical context: quotes, character classes, escapes, flags, keywords', async () => {
    const cases = [
      'const re = /"\'/;',
      'const re = /[/`]/;',
      'const re = /\\/`/g;',
      'x = y.replace(/`/g, "");',
      'if (ok) x = /`/.test(s);',
      'const q = typeof /`/;',
    ];
    for (const head of cases) {
      const text = `{do}\n${head}\nconst v = \`a\n   b\`;\n{/do}\n`;
      const expected = `{do}\n  ${head}\n  const v = \`a\n   b\`;\n{/do}\n`;
      expect(await fmt(text), head).toBe(expected);
      expect(await fmt(expected), head).toBe(expected);
    }
    const nested = '{do}\nconst v = `a\n  ${ /`/.test(s) }\n   b`;\n{/do}\n';
    expect(await fmt(nested)).toBe(
      '{do}\n  const v = `a\n  ${ /`/.test(s) }\n   b`;\n{/do}\n',
    );
  });

  it('division is not a regex, so the template after it is protected; comments still are', async () => {
    const division = '{do}\nconst q = a / b / c;\nconst v = `a\n  b`;\n{/do}\n';
    expect(await fmt(division)).toBe(
      '{do}\n  const q = a / b / c;\n  const v = `a\n  b`;\n{/do}\n',
    );
    const afterParen =
      '{do}\nconst q = (a) / 2 + b[0] / 3;\nconst v = `a\n   b`;\n{/do}\n';
    expect(await fmt(afterParen)).toBe(
      '{do}\n  const q = (a) / 2 + b[0] / 3;\n  const v = `a\n   b`;\n{/do}\n',
    );
    const comment = '{do}\nx(); // /`/\nconst v = `a\n  b`;\n{/do}\n';
    expect(await fmt(comment)).toBe(
      '{do}\n  x(); // /`/\n  const v = `a\n  b`;\n{/do}\n',
    );
  });

  it('text around a {do} body and single-line bodies are still formatted', async () => {
    expect(await fmt('   prose \n{do}\n   foo();\n{/do}\n')).toBe(
      'prose\n{do}\n  foo();\n{/do}\n',
    );
  });
});
