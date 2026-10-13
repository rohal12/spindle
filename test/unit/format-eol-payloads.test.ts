/**
 * Formatting keeps every runtime macro payload intact wherever the macro sits
 * (markup, containers, HTML, odd brace spans), and keeps the line-ending
 * style.
 */
import { describe, expect, it } from 'vitest';
import * as prettier from 'prettier';
import { formatPassage } from '../../src/format/format-passage';
import { tokenizeMarkupTolerant } from '../../src/markup/parse';

const fmt = (body: string) => formatPassage(body, { prettier });

/** The runtime view of a passage: compiler-normalized newlines, executable tokens only. */
function payloads(text: string): string[] {
  return tokenizeMarkupTolerant(text.replace(/\r\n/g, '\n'))
    .tokens.filter(
      (t) => t.type === 'macro' || t.type === 'expression' || t.type === 'link',
    )
    .map((t) =>
      t.type === 'macro'
        ? `${t.isClose ? '/' : ''}${t.name} ${t.rawArgs}`
        : t.type === 'link'
          ? `[[${t.target}]]`
          : t.expression,
    );
}

const EOLS = ['\n', '\r\n'] as const;

describe('multiline macros survive every formatter path', () => {
  const cases: Record<string, string> = {
    'template inside a container (indentation)':
      '{if $x}\n{set $a = `a\nb`}\n{/if}',
    'template with leading and trailing space lines':
      '{print `a   \n   b   \n  c`}\n',
    'template with HTML-looking lines (region segmentation)':
      '{print `\n<div>\nx   y\n</div>\n`}\n',
    'template with a script-looking line':
      '{print `\n<script>\nlet  a=1\n</script>\n`}\n',
    'template with an svg-looking line':
      '{print `\n<svg a="1"\n b="2">\n</svg>\n`}\n',
    'template in HTML region': '<div>\n<p>{print `a\n  b`}</p>\n</div>\n',
    'multiline link': '{if $x}\n[[Go|a\nb]]\n{/if}\n',
    'opener with multiline argument keeps its container role':
      '{if `a\nb` === "x"}\nbody\n{/if}\n',
    'stray brace in a string extends the span':
      '{if $x}\n{set $s = "{"}\nprose    here }\n  after\n{/if}\n',
    'unterminated macro is text and following macros format':
      '{if $x}\n{set $y = 1\n{set $z = 2}\n{/if}\n',
    'nested ${} multiline':
      '{if $x}\n{print `x ${ {a: 1}.a }\n   y   z`}\n{/if}\n',
  };
  for (const eol of EOLS) {
    for (const [name, source] of Object.entries(cases)) {
      it(`${eol.length === 2 ? 'CRLF' : 'LF'}: ${name}`, async () => {
        const text = source.replace(/\n/g, eol);
        const output = await fmt(text);
        expect(payloads(output)).toEqual(payloads(text));
        expect(await fmt(output)).toBe(output);
      });
    }
  }

  it('control: a single-line macro in a container is still indented', async () => {
    expect(await fmt('{if $x}\n{set $a = 1}\n{/if}')).toBe(
      '{if $x}\n  {set $a = 1}\n{/if}\n',
    );
  });

  it('control: text around a multiline macro is still formatted', async () => {
    const output = await fmt(
      '{if $x}\n   prose \n{set $a = `a\n  b`}\n   more \n{/if}',
    );
    expect(output).toBe(
      '{if $x}\n  prose\n  {set $a = `a\n  b`}\n  more\n{/if}\n',
    );
  });
});

describe('formatting keeps the passage line-ending style', () => {
  const crlf = (s: string) => s.replace(/\n/g, '\r\n');

  it('a CRLF passage stays CRLF throughout', async () => {
    const text = crlf(
      '{if $x}\nhi \n{set $a = `a\nb`}\n{/if}\n\n<div>\n<p>x</p>\n</div>\n',
    );
    const output = await fmt(text);
    expect(output.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(output).toBe(
      crlf(
        '{if $x}\n  hi\n  {set $a = `a\nb`}\n{/if}\n\n<div>\n  <p>x</p>\n</div>\n',
      ),
    );
  });

  it('a CRLF passage without a final newline gets a CRLF one', async () => {
    expect(await fmt('hi\r\nthere')).toBe('hi\r\nthere\r\n');
  });

  it('an already formatted CRLF passage is unchanged (idempotent)', async () => {
    const text = crlf('{if $x}\n  hi\n{/if}\n');
    expect(await fmt(text)).toBe(text);
  });

  it('an LF passage stays LF', async () => {
    expect(await fmt('hi \nthere')).toBe('hi\nthere\n');
  });

  it('mixed endings follow the dominant style', async () => {
    expect(await fmt('a\r\nb\r\nc\n')).toBe('a\r\nb\r\nc\r\n');
    expect(await fmt('a\nb\r\nc\n')).toBe('a\nb\nc\n');
  });

  it('a CRLF passage formats the same as its LF twin', async () => {
    const lf = '{if $x}\n<b>hi</b>\n{else}\nno\n{/if}\n';
    expect(await fmt(crlf(lf))).toBe(crlf(await fmt(lf)));
  });
});
