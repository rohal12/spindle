import { Parser } from 'acorn';
import { expect, it, vi } from 'vitest';
import { CodeSyntaxError, parseCode } from '../../src/js-lexer';
import { validateStoryMarkup } from '../../src/tooling';

const doMacro = [
  { name: 'do', block: true, subMacros: [], source: 'builtin' as const },
];

it.each(['parseCode', 'validateStoryMarkup'] as const)(
  '%s reads repeated contextual-name modulo statements in linear work (#711)',
  (api) => {
    // Count real tokenizer work, including retries and error diagnostics;
    // retaining one whole-prefix retry per modulo makes 8x input cost ~64x.
    const tokenizer = Parser.prototype as unknown as { nextToken(): void };
    const nextToken = vi.spyOn(tokenizer, 'nextToken');
    const work = (n: number) => {
      nextToken.mockClear();
      const body = 'const of = 1, p = 2;\n' + '0\nof %p;\n'.repeat(n);
      if (api === 'parseCode') {
        expect(parseCode(body, 'statements')).toEqual({
          refs: [],
          strings: [],
        });
      } else {
        expect(
          validateStoryMarkup(
            [{ name: 'Start', content: '{do}\n' + body + '{/do}' }],
            doMacro,
          ),
        ).toEqual([]);
      }
      return nextToken.mock.calls.length;
    };
    try {
      const small = work(20);
      expect(work(160)).toBeLessThan(small * 12);
    } finally {
      nextToken.mockRestore();
    }
  },
);

it.each([
  ['for (const of of %list) { %out = of %p; }', ['%list', '%out']],
  ['for (let of of %list) { %out = of %p; }', ['%list', '%out']],
  ['for (var of of %list) { %out = of %p; }', ['%list', '%out']],
  ['for (of of %list) { %out = of %p; }', ['%list', '%out']],
  ['for ({of} of %list) { %out = of %p; }', ['%list', '%out']],
  ['function* g() { yield %value; }', ['%value']],
  ['async function f() { await %value; }', ['%value']],
  ['async function* g() { yield await %value; }', ['%value']],
  ['for (p of\nclass C extends Object {} %Math) {}', []],
  ['for (p of\nfunction () {} %Math) {}', []],
  ['async function f() { await class C {} %Math; }', []],
  ['function* g() { yield\nclass C {}\n%value; }', ['%value']],
  ['function* g() { yield\nfunction f() {}\n%value; }', ['%value']],
  ['function* g() { yield\nasync function f() {}\n%value; }', ['%value']],
  ['async function f() { for await (const of of %list) {} }', ['%list']],
  ['const of = 3;\n0\nof\n%value = 1;', ['%value']],
] as const)(
  'distinguishes modulo and transient operands in %s',
  (body, refs) => {
    expect(
      parseCode(body, 'statements').refs.map((r) => r.sigil + r.name),
    ).toEqual(refs);
    expect(
      validateStoryMarkup(
        [{ name: 'Start', content: `{do}${body}{/do}` }],
        doMacro,
      ),
    ).toEqual([]);
  },
);

it('keeps the syntax error after many corrected modulo statements (#711)', () => {
  const body = 'const of = 1, p = 2;\n' + '0\nof %p;\n'.repeat(20) + '%last +';
  try {
    parseCode(body, 'statements');
    expect.fail('Expected an incomplete expression to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(CodeSyntaxError);
    expect((error as CodeSyntaxError).pos).toBe(body.length);
  }
});
