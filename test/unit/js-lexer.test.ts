import { describe, it, expect } from 'vitest';
import { lexJs, lexTemplate, scanStringLiteral } from '../../src/js-lexer';

type Piece = [
  kind: 'code' | 'literal' | 'transient',
  text: string,
  nest: number,
];

/** Lex `src`, merging adjacent code characters into one piece. */
function pieces(src: string): Piece[] {
  const out: Piece[] = [];
  lexJs(src, {
    code(ch, _i, nesting) {
      const last = out[out.length - 1];
      if (last && last[0] === 'code' && last[2] === nesting) last[1] += ch;
      else out.push(['code', ch, nesting]);
    },
    literal(text, _i, nesting) {
      out.push(['literal', text, nesting]);
    },
    transient(name, _i, nesting) {
      out.push(['transient', name, nesting]);
    },
  });
  return out;
}

/** Literal pieces at top level. */
const literals = (src: string) =>
  pieces(src)
    .filter(([kind, , nest]) => kind === 'literal' && nest === 0)
    .map(([, text]) => text);

describe('lexJs', () => {
  it('reports every character exactly once, in order', () => {
    const src = 'a = /x"/g.test(`${%t + "}"}`) // c\n%u / 2';
    let rebuilt = '';
    let next = 0;
    lexJs(src, {
      code(ch, i) {
        expect(i).toBe(next);
        rebuilt += ch;
        next = i + 1;
      },
      literal(text, i) {
        expect(i).toBe(next);
        rebuilt += text;
        next = i + text.length;
      },
      transient(name, i) {
        expect(i).toBe(next);
        rebuilt += '%' + name;
        next = i + 1 + name.length;
      },
    });
    expect(rebuilt).toBe(src);
  });

  it('reads a regex literal in operand position', () => {
    expect(literals('/"/.test(x)')).toEqual(['/"/']);
    expect(literals('f(/a b/g, y)')).toEqual(['/a b/g']);
    expect(literals('x = /[/"]/')).toEqual(['/[/"]/']);
    expect(literals(String.raw`return /\/"/`)).toEqual([String.raw`/\/"/`]);
  });

  it('reads a slash after an operand as division', () => {
    expect(literals('a / b "label"')).toEqual(['"label"']);
    expect(literals('x /2/ y')).toEqual([]);
    expect(literals('(a) / 2 / "b"')).toEqual(['"b"']);
    expect(literals('a[0] / 2 / "b"')).toEqual(['"b"']);
  });

  it('reports string literals and comments as literal text', () => {
    expect(literals(`"a" + 'b' /* c */ // d`)).toEqual([
      '"a"',
      "'b'",
      '/* c */',
      '// d',
    ]);
  });

  it('lexes template interpolations one nesting level deeper', () => {
    expect(pieces('`a${b + /`/.source}c`')).toEqual([
      ['literal', '`', 0],
      ['literal', 'a', 0],
      ['literal', '${', 0],
      ['code', 'b + ', 1],
      ['literal', '/`/', 1],
      ['code', '.source', 1],
      ['literal', '}', 0],
      ['literal', 'c', 0],
      ['literal', '`', 0],
    ]);
  });

  it('reports transient references in operand position only', () => {
    expect(pieces('%a % 2')).toEqual([
      ['transient', 'a', 0],
      ['code', ' % 2', 0],
    ]);
  });
});

describe('lexTemplate', () => {
  it('returns the index just past the closing backtick', () => {
    expect(lexTemplate('`a ${"`"} b` x', 0)).toBe(12);
    expect(lexTemplate('`a ${/[`}]/} b` x', 0)).toBe(15);
  });

  it('returns the input length when unterminated', () => {
    expect(lexTemplate('`abc', 0)).toBe(4);
    expect(lexTemplate('`abc\\', 0)).toBe(5);
  });
});

describe('scanStringLiteral', () => {
  it('finds the closing quote, honouring backslash runs', () => {
    expect(scanStringLiteral(String.raw`"a\"b" x`, 0)).toEqual({
      end: 6,
      closed: true,
    });
    expect(scanStringLiteral(String.raw`"C:\\" x`, 0)).toEqual({
      end: 6,
      closed: true,
    });
  });

  it('reports an unterminated string', () => {
    expect(scanStringLiteral(String.raw`"abc\"`, 0)).toEqual({
      end: 6,
      closed: false,
    });
  });
});
