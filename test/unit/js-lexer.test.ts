import { describe, it, expect } from 'vitest';
import {
  createJsScanCache,
  findCodeEnd,
  lexJs,
  lexTemplate,
  scanStringLiteral,
} from '../../src/js-lexer';
import type { JsGoal } from '../../src/js-lexer';

type Piece = [
  kind: 'code' | 'literal' | 'variable',
  text: string,
  nest: number,
];

/** Lex `src`, merging adjacent code characters into one piece. */
function pieces(src: string, goal?: JsGoal): Piece[] {
  const out: Piece[] = [];
  lexJs(
    src,
    {
      code(ch, _i, nesting) {
        const last = out[out.length - 1];
        if (last && last[0] === 'code' && last[2] === nesting) last[1] += ch;
        else out.push(['code', ch, nesting]);
      },
      literal(text, _i, nesting) {
        out.push(['literal', text, nesting]);
      },
      variable(sigil, name, _i, nesting) {
        out.push(['variable', sigil + name, nesting]);
      },
    },
    goal,
  );
  return out;
}

/** Literal pieces at top level. */
const literals = (src: string, goal?: JsGoal) =>
  pieces(src, goal)
    .filter(([kind, , nest]) => kind === 'literal' && nest === 0)
    .map(([, text]) => text);

describe('lexJs', () => {
  it('reports every character exactly once, in order', () => {
    const src = 'a = /x"/g.test(`${%t + "}" + $v}`) // c\n%u / _w + @l';
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
      variable(sigil, name, i) {
        expect(i).toBe(next);
        rebuilt += sigil + name;
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

  it('reads a slash after an object literal as division', () => {
    // Found by property testing: `}` closing an object literal was read as
    // the end of a block, so the `/` after it opened a regex.
    expect(literals('-{}/-[]')).toEqual([]);
    expect(literals('[{a: 1} / 2, "x"]')).toEqual(['"x"']);
    expect(literals('`${ {} / 2 }`')).toEqual(['`', '${', '}', '`']);
    expect(literals('x ? {} / 2 : "y"')).toEqual(['"y"']);
    expect(literals('return {} / 2')).toEqual([]);
  });

  it('reads a slash after a block as the start of a regex', () => {
    // Blocks only exist in statement lists ({do} bodies); in an expression
    // `{}` is an object literal and a following `/` is division.
    const regex = (src: string) => literals(src, 'statements');
    expect(regex('if (x) {}\n/a"/.test(s)')).toEqual(['/a"/']);
    expect(regex('{}\n/a"/.test(s)')).toEqual(['/a"/']);
    expect(regex('f = () => {}\n/a"/.test(s)')).toEqual(['/a"/']);
    expect(regex('if (x) {} else {}\n/a"/.test(s)')).toEqual(['/a"/']);
    expect(regex('do {} while (x); try {} finally {}\n/a"/')).toEqual(['/a"/']);
    expect(regex('function f() {}\n/a"/.test(s)')).toEqual(['/a"/']);
    // As an expression, `{} / a` is division, so the `"` opens a string.
    expect(literals('{}\n/a"/.test(s)')).toEqual(['"/.test(s)']);
  });

  it('reads a % after an object literal as modulo', () => {
    expect(pieces('[{} %n]')).toEqual([['code', '[{} %n]', 0]]);
    expect(pieces('if (x) {} %n = 1', 'statements')).toEqual([
      ['code', 'if (x) {} ', 0],
      ['variable', '%n', 0],
      ['code', ' = 1', 0],
    ]);
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
      ['variable', '%a', 0],
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

describe('lexJs nesting', () => {
  it('lexes deeply nested template literals without recursion', () => {
    const depth = 5000;
    const src = '`${'.repeat(depth) + '$a' + '}`'.repeat(depth);
    let maxNesting = 0;
    let variables = 0;
    lexJs(src, {
      variable(_sigil, _name, _i, nesting) {
        variables++;
        maxNesting = Math.max(maxNesting, nesting);
      },
    });
    expect(variables).toBe(1);
    expect(maxNesting).toBe(depth);
  });

  it('keeps a stray closer in an interpolation from closing outer brackets', () => {
    expect(pieces('(`${)}`) / 2')).toEqual([
      ['code', '(', 0],
      ['literal', '`', 0],
      ['literal', '${', 0],
      ['code', ')', 1],
      ['literal', '}', 0],
      ['literal', '`', 0],
      ['code', ') / 2', 0],
    ]);
  });
});

describe('findCodeEnd', () => {
  it('finds the } closing the code, skipping literals and comments', () => {
    expect(findCodeEnd('/}/.test(s)} x', 0)).toBe(11);
    expect(findCodeEnd('a /* } */ + "}" + `${"}"}` } x', 0)).toBe(27);
    expect(findCodeEnd('a // }\n} x', 0)).toBe(7);
    expect(findCodeEnd('{ a: [/]}/] } } x', 0)).toBe(14);
  });

  it('reads / after an operand as division', () => {
    expect(findCodeEnd('a /2/ b} x', 0)).toBe(7);
    expect(findCodeEnd('(a) / 2 } x', 0)).toBe(8);
  });

  it('does not let a stray ) close the braces around it', () => {
    expect(findCodeEnd('({ ) }) } x', 0)).toBe(8);
  });

  it('returns -1 for code that is not well-formed', () => {
    expect(findCodeEnd("don't }", 0)).toBe(-1);
    expect(findCodeEnd('"a }', 0)).toBe(-1);
    expect(findCodeEnd('/a }\n}', 0)).toBe(-1);
    expect(findCodeEnd('/* }', 0)).toBe(-1);
    expect(findCodeEnd('(a }', 0)).toBe(-1);
  });

  it('accepts a string right after a keyword or modifier', () => {
    expect(findCodeEnd("typeof'}' } x", 0)).toBe(10);
    expect(findCodeEnd("class { static'}' } } x", 0)).toBe(20);
  });

  it('stops where `stop` holds, in code at any depth', () => {
    const src = 'a = "{/do}"; if (b) { c(){/do} x';
    const stop = (i: number) => src.startsWith('{/do}', i);
    expect(findCodeEnd(src, 0, { goal: 'statements', stop })).toBe(25);
  });
});

describe('findCodeEnd with a shared cache', () => {
  /** Scan `src` from each start in turn, sharing all results. */
  const scanAll = (src: string, starts: number[]) => {
    const cache = createJsScanCache();
    cache.shareAfter = 0;
    return starts.map((start) => findCodeEnd(src, start, { cache }));
  };

  // A scan that lexed the brackets records how they end, for the next scan
  // opening them to skip them. The function or class body to come is not
  // the same after them: one they start replaces it, and is gone when they
  // close.
  it.each([
    ['x = function f(a = function(){}) {} /}/ }', 40],
    ['x = function f(a = class {}) {} /}/ }', 36],
    ['x = class A extends (function(){}) {} /}/ }', 42],
    ['x = function f([a] = [function(){}]) {} /}/ }', 44],
  ])('%j: a body started in brackets is not the one to come', (src, end) => {
    const brackets = src.indexOf('(');
    expect(scanAll(src, [brackets, 0])).toEqual([
      findCodeEnd(src, brackets),
      end,
    ]);
  });

  // Inside unclosed brackets, a stray } closes no braces around them, so
  // where they end is the same for every scan opening them there.
  it('shares how unclosed brackets end across scans', () => {
    const src = '( a[[}'.repeat(3);
    const starts = [0, 6, 12, 3, 9];
    expect(scanAll(src, starts)).toEqual(
      starts.map((s) => findCodeEnd(src, s)),
    );
  });

  // Brackets in braces: a } in them closes the braces, so how they end
  // depends on what is around them.
  it('keeps apart brackets that a } closes and brackets it does not', () => {
    const src = '{ ( } ) } x';
    // From 2 the brackets close at 6; from 0 the } at 4 closes the braces
    // and the brackets with them, and the } at 8 ends the code
    expect(scanAll(src, [2, 0])).toEqual([8, 8]);
  });
});
