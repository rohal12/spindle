/**
 * Formatting keeps the JavaScript values a passage produces. A template
 * literal (or a backslash-continued string) that spans lines is a value, so
 * its line breaks and the whitespace after them stay: in {do} bodies and in
 * <script> regions, and line wrapping never breaks JavaScript.
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

describe('multiline JavaScript literals in <script> regions', () => {
  it('a template literal keeps its lines, and Format is idempotent', async () => {
    const text = '<script>\nconst s = `a\nb`;\n</script>\n';
    const expected = '<script>\n  const s = `a\nb`;\n</script>\n';
    expect(await fmt(text)).toBe(expected);
    expect(await fmt(expected)).toBe(expected);
  });

  it('a backslash-continued string keeps its value', async () => {
    const text = "<script>\nconst s = 'a\\\nb';\n</script>";
    const output = await fmt(text);
    // The continuation line is not indented: the value stays `ab`
    expect(output).toContain('\nb";\n');
    expect(await fmt(output)).toBe(output);
  });

  it('inside a block macro and in an HTML block', async () => {
    const inMacro =
      '{if $x}\n<script>\nconst s = `a\n  b`;\n</script>\n{/if}\n';
    const once = await fmt(inMacro);
    expect(once).toContain('`a\n  b`');
    expect(await fmt(once)).toBe(once);
    const inHtml = '<div>\n<script>\nconst s = `a\nb`;\n</script>\n</div>\n';
    const html = await fmt(inHtml);
    expect(html).toContain('`a\nb`');
    expect(await fmt(html)).toBe(html);
    const handler = '<div>\n<button onclick="x(`a\nb`)">go</button>\n</div>\n';
    const attribute = await fmt(handler);
    expect(attribute).toContain('x(`a\nb`)');
    expect(await fmt(attribute)).toBe(attribute);
  });
});

describe('line wrapping leaves {do} bodies alone', () => {
  it('does not break a long line of JavaScript', async () => {
    const text =
      '{do}\nconst s = "one two three four five six seven eight nine ten";\n{/do}\n';
    const expected =
      '{do}\n  const s = "one two three four five six seven eight nine ten";\n{/do}\n';
    const output = await formatPassage(text, { prettier, maxLineLength: 30 });
    expect(output).toBe(expected);
    const inline =
      'Some prose {do}x("one two three four five six seven");{/do} more';
    expect(await formatPassage(inline, { prettier, maxLineLength: 30 })).toBe(
      inline + '\n',
    );
  });
});
