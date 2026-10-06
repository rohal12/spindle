import { describe, it, expect } from 'vitest';
import {
  CodeSyntaxError,
  findCodeEnd,
  lexJs,
  lexTemplate,
  parseCode,
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

  // A `%name` starting a line after an operand is a transient when the line
  // assigns to it (docs/variables.md "Code in passages"); otherwise `%` is
  // the modulo operator, and a `;` ends the line before.
  it('reads a %name assigned to at a line start as a transient', () => {
    const transients = (src: string) =>
      pieces(src, 'statements')
        .filter(([kind]) => kind === 'variable')
        .map(([, text]) => text);
    expect(transients('y\n%c[ i ] = 1')).toEqual(['%c']);
    expect(transients('y\n%c /* c */ .d += 1')).toEqual(['%c']);
    expect(transients('y\n%c // c\n[ a["]"] ] ??= 1')).toEqual(['%c']);
    expect(transients('y\n%c[ ( ] = 1')).toEqual([]);
    expect(transients('y\n%c.go()')).toEqual([]);
    expect(transients('y;\n%c.go()')).toEqual(['%c']);
    expect(transients('y\n%c == 1')).toEqual([]);
  });

  it('reads a %name after a prefix ++ as a transient, after a postfix one as modulo', () => {
    const kinds = (src: string) => pieces(src).map(([kind]) => kind);
    expect(kinds('++%n')).toEqual(['code', 'variable']);
    expect(kinds('$n++ %n')).toEqual(['variable', 'code']);
    expect(kinds('a\n++%n')).toEqual(['code', 'variable']);
  });

  it('reads a { after the : of a conditional as an object literal', () => {
    expect(literals('p ? 1 : {} / 2 / "x"', 'statements')).toEqual(['"x"']);
    expect(literals('lbl: {}\n/a"/.test(s)', 'statements')).toEqual(['/a"/']);
  });

  it('reads a function or class expression starting an expression as an operand', () => {
    expect(literals('class {} / 2 / "x"')).toEqual(['"x"']);
    expect(literals('function () {} / 2 / "x"')).toEqual(['"x"']);
  });

  it('reads characters no JavaScript has as code, and goes on after them', () => {
    expect(pieces('a # "b" \\')).toEqual([
      ['code', 'a # ', 0],
      ['literal', '"b"', 0],
      ['code', ' \\', 0],
    ]);
  });

  it('reads a quoted string across lines as one literal', () => {
    expect(literals('"a\nb" "c"')).toEqual(['"a\nb"', '"c"']);
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
  });

  it('reads keywords that are names as names', () => {
    // A field named `function`, then a regex: no function body opens
    const src = 'class D { function; }\n/}/.test(s) } x';
    expect(findCodeEnd(src, 0, { goal: 'statements' })).toBe(
      src.indexOf('} x'),
    );
    // A static block holds statements: a function declaration, then a regex
    const block = 'class C { static { function f() {} /}/ } } } x';
    expect(findCodeEnd(block, 0, { goal: 'statements' })).toBe(
      block.indexOf('} x'),
    );
    expect(
      pieces('p.in\nfunction f() {}\n/a"/.test(s)', 'statements'),
    ).toContainEqual(['literal', '/a"/', 0]);
  });

  it('reads a word starting with a digit as one, as delays are written', () => {
    expect(findCodeEnd('2s // }\n} x', 0)).toBe(8);
    expect(findCodeEnd('0_$ /* } */ } x', 0)).toBe(12);
  });

  it('skips characters no JavaScript has', () => {
    expect(findCodeEnd('a \u2192 b } x', 0)).toBe(6);
    // `@` alone, then a regex holding the `{/do}` that does not end the body
    const src = '@=/[{/do}]a/g{/do} x';
    const stop = (i: number) => src.startsWith('{/do}', i);
    expect(findCodeEnd(src, 0, { goal: 'statements', stop })).toBe(13);
  });

  it('reads a { after a block, or a statement and a line break, as a block', () => {
    const src = '{ }{ } %n = /}/ } x';
    expect(findCodeEnd(src, 0, { goal: 'statements' })).toBe(16);
    const kinds = (code: string) =>
      pieces(code, 'statements').map(([kind]) => kind);
    expect(kinds('p\n{ } %n = 1')).toEqual(['code', 'variable', 'code']);
    expect(kinds('x = {}\n{ } %n = 1')).toEqual(['code', 'variable', 'code']);
    // On one line, `{}` after an operand is no block: `%` is modulo
    expect(kinds('x = a ? {} : {} %n')).toEqual(['code']);
  });

  it('ends the code at a } in an unclosed bracket, for the parse to report', () => {
    expect(findCodeEnd('(a } x', 0)).toBe(3);
    expect(findCodeEnd('[1, 2} x', 0)).toBe(5);
  });

  it('reads a quoted string across lines, as quoted labels may be', () => {
    expect(findCodeEnd('"a\n}" } x', 0)).toBe(6);
  });

  // A backtick in an interpolation the code never closes opens a template
  // of its own, which never ends: it is read as closing the template around
  // it instead, so the code ends where its author meant it to.
  it('ends the code after a template literal whose interpolation is unclosed', () => {
    const src = ' $s = `Hi ${$name`} after';
    expect(findCodeEnd(src, 0)).toBe(src.indexOf('} after'));
  });

  it('reads an object literal after the : of a conditional', () => {
    // A block there would make `/\nMath}…` an unterminated regex
    const src = 'p ? "" : { //\n} /\nMath} x';
    expect(findCodeEnd(src, 0, { goal: 'statements' })).toBe(
      src.indexOf('} x'),
    );
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

describe('parseCode', () => {
  it('finds the references in code, but not property names', () => {
    const refs = parseCode('a.$b + { $c: 1, _d() {} }.c + $e + @f + %g % 2');
    expect(refs.refs.map((r) => r.sigil + r.name)).toEqual(['$e', '@f', '%g']);
  });

  it('marks shorthand properties', () => {
    const { refs } = parseCode('({ $gold, x: @y })');
    expect(refs.map((r) => [r.sigil + r.name, r.shorthand])).toEqual([
      ['$gold', true],
      ['@y', false],
    ]);
  });

  it('reports the text of string literals and template pieces', () => {
    expect(parseCode('"a{$b}" + `c${$d}e`').strings).toEqual([
      'a{$b}',
      'c',
      'e',
    ]);
  });

  /** The error `parseCode` throws for `src`. */
  const error = (
    src: string,
    goal: 'expression' | 'statements' = 'expression',
  ) => {
    try {
      parseCode(src, goal);
    } catch (e) {
      expect(e).toBeInstanceOf(CodeSyntaxError);
      return e as CodeSyntaxError;
    }
    throw new Error(`no error for ${src}`);
  };

  // What authors see for typical mistakes: the reason, where (column, and
  // line for code over several lines), the line marked there, and the
  // bracket left open when that is the likely cause.
  it.each([
    [
      '$gold > ',
      'expression',
      'Unexpected end of code at column 9: $gold > ▶',
      8,
    ],
    [
      '$name = "Bob',
      'statements',
      'Unterminated string constant at column 9: $name = ▶"Bob',
      8,
    ],
    [
      '($gold + $count',
      'expression',
      'Unexpected end of code at column 16: ($gold + $count▶ (missing ")" for the "(" at column 1)',
      15,
    ],
    [
      '$name.toUpperCase(',
      'expression',
      'Unexpected end of code at column 19: $name.toUpperCase(▶ (missing ")" for the "(" at column 18)',
      18,
    ],
    [
      'if ($gold < 10 {\n  $gold = 10;\n}',
      'statements',
      'Unexpected "{" at line 1, column 16: if ($gold < 10 ▶{ (missing ")" for the "(" at line 1, column 4)',
      15,
    ],
    [
      '$list.push("rope";',
      'statements',
      'Unexpected ";" at column 18: $list.push("rope"▶; (missing ")" for the "(" at column 11)',
      17,
    ],
    [
      '$gold $count',
      'expression',
      'Unexpected "$count" at column 7: $gold ▶$count',
      6,
    ],
    [
      'const o = { a: 1\n  b: 2 };',
      'statements',
      'Unexpected "b" at line 2, column 3: ▶b: 2 };',
      19,
    ],
    [
      '$count = $count ++ 1',
      'statements',
      'Unexpected "1" at column 20: $count = $count ++ ▶1',
      19,
    ],
    [
      '$list = [1, 2',
      'statements',
      'Unexpected end of code at column 14: $list = [1, 2▶ (missing "]" for the "[" at column 9)',
      13,
    ],
    [
      "$name == Bob's",
      'expression',
      "Unterminated string constant at column 13: $name == Bob▶'s",
      12,
    ],
    [
      '$s = `Hi ${$name`',
      'statements',
      'Unterminated template literal at column 18: $s = `Hi ${$name`▶ (missing "}" for the "${" at column 10)',
      17,
    ],
  ] as const)('%j: %s', (src, goal, message, pos) => {
    const e = error(src, goal);
    expect(e.message).toBe(message);
    expect(e.pos).toBe(pos);
  });

  it('describes an error with the place of its open bracket in a passage', () => {
    const passage = 'Text\n{do}\nif ($gold < 10 {\n}\n{/do}';
    const code = 'if ($gold < 10 {\n}';
    const e = error(code, 'statements');
    expect(e.reasonIn(passage, passage.indexOf('if'))).toBe(
      'Unexpected "{" (missing ")" for the "(" at line 3, column 4)',
    );
    expect(e.pos).toBe(15);
  });

  it('rejects declaring a sigil variable', () => {
    expect(error('let _x = 1', 'statements').message).toBe(
      '"_x" is a temporary variable and can\'t be declared at column 5: let ▶_x = 1',
    );
    expect(error('(_a) => _a').message).toMatch(
      /^"_a" is a temporary variable/,
    );
    expect(error('function f($x) {}', 'statements').message).toMatch(
      /^"\$x" is a story variable/,
    );
  });

  it('rejects a local or transient as a property name', () => {
    expect(error('obj.@x').message).toBe(
      '"@x" can\'t be a property name at column 5: obj.▶@x',
    );
  });

  it('rejects code that is not valid JavaScript, though V8 would run it', () => {
    expect(error('++f()').reason).toBe('Assigning to rvalue');
    expect(error('f() = 1', 'statements').reason).toBe('Assigning to rvalue');
  });

  it('reads a % as the parser needs it, where the tokens before mislead', () => {
    // The tokens before guess an operator: `of` reads as a variable here
    const { refs } = parseCode('for (const of of %list) {}', 'statements');
    expect(refs.map((r) => r.sigil + r.name)).toEqual(['%list']);
    // …and the other way round: after a statement, `of % p` divides
    expect(parseCode('a\nof % p', 'statements').refs).toEqual([]);
  });

  it('reads a keyword after ?. as a property name', () => {
    expect(pieces('a?.typeof %n')).toEqual([['code', 'a?.typeof %n', 0]]);
  });

  it('parses valid code that guessing regex or division gets wrong', () => {
    expect(() => parseCode('class C extends Object {} / 0')).not.toThrow();
    expect(() => parseCode('function () {} / 2')).not.toThrow();
    expect(() => parseCode('p ? 1 : {} / 2', 'statements')).not.toThrow();
    expect(() => parseCode('{ a: 1 }')).not.toThrow();
  });
});
