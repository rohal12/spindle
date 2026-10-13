/**
 * The formatter protects the spans Spindle's tokenizer executes: braces
 * inside string and template literals do not count, and a macro ends at its
 * own `}`.
 *
 * The oracle is the tokenizer: formatting must keep every macro's payload
 * (`rawArgs`) and the passage's token sequence, and be idempotent.
 */
import { describe, expect, it } from 'vitest';
import * as prettier from 'prettier';
import { formatPassage } from '../../src/format/format-passage';
import { scanSpindleMarkup } from '../../src/format/placeholders';
import { tokenizeMarkupTolerant } from '../../src/markup/parse';

const fmt = (body: string) => formatPassage(body, { prettier });
const tokenize = (text: string) => tokenizeMarkupTolerant(text).tokens;

/** The macro payloads and token kinds the tokenizer reads, ignoring text. */
function payloads(text: string) {
  return tokenize(text).flatMap((t) =>
    t.type === 'macro'
      ? [`${t.isClose ? '/' : ''}${t.name}:${t.rawArgs}`]
      : t.type === 'text'
        ? []
        : [t.type],
  );
}

const stray = '{if $x}\n{set $s = "{"}\n   keep   this }\nafter\n{/if}\n';
const template = '{if $x}\n{print `a{`}\n   keep   this }\n{/if}\n';

describe('formatting keeps what the tokenizer executes', () => {
  const cases: [string, string][] = [
    ['string with a stray brace', stray],
    ['template with a stray brace', template],
  ];
  for (const [name, text] of cases) {
    for (const eol of ['\n', '\r\n']) {
      it(`payloads of a ${name} (${eol === '\n' ? 'LF' : 'CRLF'})`, async () => {
        const source = text.replace(/\n/g, eol);
        const out = await fmt(source);
        // Macro payloads are the runtime's arguments: byte-identical (CRLF normalizes to LF in the compiler)
        expect(payloads(out.replace(/\r\n/g, '\n'))).toEqual(
          payloads(source.replace(/\r\n/g, '\n')),
        );
        expect(await fmt(out)).toBe(out);
      });
    }
  }

  it("the scanned spans are the tokenizer's, outside HTML tags", () => {
    for (const text of [
      stray,
      template,
      '{set $s = "{"}\nx {y}',
      '{print "}"} {z}',
    ]) {
      const spans = scanSpindleMarkup(text).tokens.map((m) => [m.start, m.end]);
      const expected = tokenize(text)
        .filter(
          (t) =>
            t.type === 'macro' ||
            t.type === 'variable' ||
            t.type === 'expression' ||
            t.type === 'link',
        )
        .map((t) => [t.start, t.end]);
      expect(spans, JSON.stringify(text)).toEqual(expected);
    }
  });
});

describe('the string is skipped, the macro ends at its own `}`', () => {
  it('the prose after a macro with a stray brace in a string is formatted', async () => {
    expect(await fmt(stray)).toBe(
      '{if $x}\n  {set $s = "{"}\n  keep   this }\n  after\n{/if}\n',
    );
  });

  it('the same for a template literal', async () => {
    expect(await fmt(template)).toBe(
      '{if $x}\n  {print `a{`}\n  keep   this }\n{/if}\n',
    );
  });
});
