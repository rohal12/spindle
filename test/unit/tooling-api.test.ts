/**
 * The parsing rules `@rohal12/spindle/tooling` exports (src/tooling.ts):
 * the same functions the runtime parses with.
 */
import { describe, it, expect } from 'vitest';
import { getMacroRegistry } from '../../src/registry';
import { parseMarkup } from '../../src/markup/parse';
import { astContainsChildren } from '../../src/widgets/ast-scanner';
import {
  parseStoryVariables,
  validatePassages,
} from '../../src/story-variables';
import {
  MarkupError,
  SIGIL_SCOPES,
  endsWithOperator,
  findCodeEnd,
  isSigil,
  lexJs,
  lexTemplate,
  parseSelectors,
  readQuoted,
  scanStringLiteral,
  splitArgs,
  splitIncludeFlag,
  splitTopLevel,
  stripLooseQuotes,
  tokenizeMarkup,
  tokenizeMarkupTolerant,
  transform,
  unescapeQuoted,
  collectStoryPassageReferences,
  evaluatePassageName,
  passageTarget,
  parseWidgetDef,
  widgetDefinitions,
  variableReferences,
  validateVariableReferences,
  parseDeclarations,
  discoverMacros,
  validateStoryMarkup,
} from '../../src/tooling';

describe('tooling API: the JavaScript lexer', () => {
  it('lexJs reports code, literals and variables, every character once', () => {
    const code: string[] = [];
    const literals: string[] = [];
    const variables: string[] = [];
    const src = '$a + "$b" /* $c */ + `x${%t}`';
    expect(
      lexJs(src, {
        code: (ch) => code.push(ch),
        literal: (text) => literals.push(text),
        variable: (sigil, name) => variables.push(sigil + name),
      }),
    ).toBe(src.length);
    expect(variables).toEqual(['$a', '%t']);
    expect(literals).toContain('"$b"');
    expect(literals).toContain('/* $c */');
  });

  it('lexJs decides regex versus division by what precedes', () => {
    const literals: string[] = [];
    lexJs('a / b / c; x = /[`]/g', { literal: (t) => literals.push(t) });
    expect(literals).toEqual(['/[`]/g']);
    const after: string[] = [];
    lexJs('f(a) /x/ 2', { literal: (t) => after.push(t) });
    expect(after).toEqual([]);
  });

  it('lexTemplate returns the index past the closing backtick', () => {
    const src = '`a${`b`}c` rest';
    expect(lexTemplate(src, 0)).toBe(src.indexOf(' rest'));
  });

  it('scanStringLiteral stops at the closing quote', () => {
    expect(scanStringLiteral('"a\\"b" c', 0)).toEqual({
      end: 6,
      closed: true,
    });
    expect(scanStringLiteral('"open', 0)).toEqual({ end: 5, closed: false });
  });

  it('findCodeEnd finds the brace that closes the code', () => {
    const src = '{$a + "}" + 1} after';
    expect(findCodeEnd(src, 1)).toBe(src.indexOf('} after'));
    expect(findCodeEnd('{$a + "', 1)).toBe(-1);
  });
});

describe('tooling API: tokens and selectors', () => {
  it('tokenizeMarkup gives flat tokens with offsets', () => {
    const tokens = tokenizeMarkup('Hi {$name}, [[Go->Hall]]{if $x}');
    expect(tokens.map((t) => t.type)).toEqual([
      'text',
      'variable',
      'text',
      'link',
      'macro',
    ]);
    const link = tokens[3]!;
    expect(link).toMatchObject({ target: 'Hall', start: 12, end: 24 });
  });

  it('tokenizeMarkup throws a MarkupError for an unclosed brace', () => {
    expect(() => tokenizeMarkup('{if $x')).toThrow(MarkupError);
  });

  it('knows the sigils', () => {
    expect(SIGIL_SCOPES['$']).toBe('variable');
    expect(isSigil('%')).toBe(true);
    expect(isSigil('a')).toBe(false);
    expect(isSigil(undefined)).toBe(false);
  });

  it('parseSelectors reads class and id selectors and where they end', () => {
    expect(parseSelectors('.big.red#hero {$x}')).toEqual({
      className: 'big red',
      id: 'hero',
      end: 14,
    });
    expect(parseSelectors('.a-{$n} rest')).toEqual({
      className: 'a-{$n}',
      end: 8,
    });
    expect(parseSelectors('{.a ', 1)).toEqual({ className: 'a', end: 4 });
    expect(parseSelectors('plain')).toEqual({ end: 0 });
  });
});

describe('tooling API: argument rules', () => {
  it('splits arguments at top-level commas and values', () => {
    expect(splitArgs('"a, b", f(1, 2), [3, 4]')).toEqual([
      '"a, b"',
      'f(1, 2)',
      '[3, 4]',
    ]);
    expect(splitArgs('"Label" "target"')).toEqual(['"Label"', '"target"']);
    expect(splitTopLevel('a b(c d) e', (ch) => ch === ' ')).toEqual([
      'a',
      'b(c d)',
      'e',
    ]);
  });

  it('reads quoted strings', () => {
    expect(readQuoted('x "a\\"b" y', 2)).toEqual({ value: 'a"b', end: 8 });
    expect(readQuoted('"open', 0)).toBeNull();
    expect(unescapeQuoted('a\\"b\\\\n')).toBe('a"b\\n');
    expect(stripLooseQuotes('"Red')).toBe('Red');
  });

  it('endsWithOperator tells incomplete expressions', () => {
    expect(endsWithOperator('$a +')).toBe(true);
    expect(endsWithOperator('$a')).toBe(false);
    expect(endsWithOperator('/x+/')).toBe(false);
  });

  it('splitIncludeFlag takes the inline flag off either end', () => {
    expect(splitIncludeFlag('inline "Room"')).toEqual({
      inline: true,
      passage: '"Room"',
    });
    expect(splitIncludeFlag('$next inline')).toEqual({
      inline: true,
      passage: '$next',
    });
    expect(splitIncludeFlag('"inline"')).toEqual({
      inline: false,
      passage: '"inline"',
    });
    expect(splitIncludeFlag('"a" + inline')).toEqual({
      inline: false,
      passage: '"a" + inline',
    });
  });
});

describe('tooling API: tolerant tokens', () => {
  const tolerant = (src: string) => tokenizeMarkupTolerant(src);

  it('gives the tokens of well-formed markup, and no errors', () => {
    const src = 'Hi {$a}, [[Go->Hall]] {if $x}yes{/if}';
    expect(tolerant(src)).toEqual({ tokens: tokenizeMarkup(src), errors: [] });
  });

  it.each([
    ['an unclosed macro', 'Hi {$a} then {if $x', 13],
    ['an unclosed link', 'a {$b} [[Go->Hal', 7],
    ['an unclosed attribute value', 'x {$b} <a href="oops', 15],
  ])('keeps the tokens before %s', (_, src, offset) => {
    const { tokens, errors } = tolerant(src);
    expect(errors.map((e) => e.offset)).toEqual([offset]);
    expect(tokens.filter((t) => t.type === 'variable')).toHaveLength(1);
    // Every character is in exactly one token, in order
    let at = 0;
    for (const t of tokens) {
      expect(t.start).toBe(at);
      at = t.end;
    }
    expect(at).toBe(src.length);
  });

  it('reads on after an error, with offsets in the source', () => {
    const src = '{if $x\n[[a]] {$b} [[open\n{$c}';
    const { tokens, errors } = tolerant(src);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ offset: 0, line: 1, column: 1 });
    expect(errors[1]).toMatchObject({ line: 2 });
    const link = tokens.find((t) => t.type === 'link')!;
    expect(src.slice(link.start, link.end)).toBe('[[a]]');
    const variables = tokens.filter((t) => t.type === 'variable');
    expect(variables.map((t) => src.slice(t.start, t.end))).toEqual([
      '{$b}',
      '{$c}',
    ]);
  });
});

describe('tooling API: passage targets', () => {
  it('reads a quoted name as its JavaScript literal, else an expression', () => {
    expect(passageTarget('"Hall"')).toEqual({ kind: 'name', name: 'Hall' });
    expect(passageTarget(' "\\u0048all" ')).toEqual({
      kind: 'name',
      name: 'Hall',
    });
    expect(passageTarget('$room')).toEqual({
      kind: 'expression',
      expression: '$room',
    });
    expect(passageTarget('"a" + $b')).toEqual({
      kind: 'expression',
      expression: '"a" + $b',
    });
  });

  it.each([
    ['a legacy octal escape', '"\\1"'],
    ['\\0 before a digit', '"\\08"'],
    ['\\u and \\x escapes', '"\\u0048\\x61ll"'],
    ['a braced code point', '"\\u{1F600}"'],
    ['a line continuation', '"Ha\\\nll"'],
    ['single quotes', "'it\\'s'"],
  ])('reads %s as JavaScript does (#262)', (_, literal) => {
    expect(passageTarget(literal)).toEqual({
      kind: 'name',
      name: new Function(`return ${literal}`)(),
    });
  });

  it.each([['"\\u{110000}"'], ['"\\x4"'], ['"a\nb"']])(
    'reads the literal %s, which JavaScript rejects, as an expression (#262)',
    (literal) => {
      expect(() => new Function(`return ${literal}`)).toThrow(SyntaxError);
      expect(passageTarget(literal).kind).toBe('expression');
    },
  );

  it('evaluates a name as the story does', () => {
    const state = {
      storyData: { passages: new Map([['Hall', {}]]) },
      currentPassage: 'Start',
    } as never;
    expect(evaluatePassageName('$x', () => 'Hall', state)).toBe('Hall');
    expect(() => evaluatePassageName('$x', () => 'Nope', state)).toThrow(
      'No passage named "Nope" (in passage "Start")',
    );
  });

  it('transforms sigil references into namespace lookups', () => {
    expect(transform('$a + _b + @c + %d + "$e"')).toBe(
      'variables["a"] + temporary["b"] + locals["c"] + transient["d"] + "$e"',
    );
    expect(transform('$a = 1; _b++', 'statements')).toBe(
      'variables["a"] = 1; temporary["b"]++',
    );
    expect(() => transform('$__proto__')).toThrow(SyntaxError);
  });
});

describe('tooling API: passage references', () => {
  const macros = getMacroRegistry();
  const refs = (src: string) => collectStoryPassageReferences(src, macros);
  const at = (src: string, ref: { start: number; end: number }) =>
    src.slice(ref.start, ref.end);

  it('finds links, macro arguments, watch actions and dialog bodies', () => {
    const src = [
      '[[Go->Hall]]',
      '{goto "Cellar"}',
      '{include $room}',
      '{link "Go" "Attic"}{/link}',
      '{watch "$x" goto "Roof" dialog "Hint"}',
      '{dialog "Title"}Basement{/dialog}',
    ].join('\n');
    const found = refs(src);
    expect(found.map((r) => [r.macro, r.target, at(src, r)])).toEqual([
      ['link', { kind: 'name', name: 'Hall' }, 'Hall'],
      ['goto', { kind: 'name', name: 'Cellar' }, '"Cellar"'],
      ['include', { kind: 'expression', expression: '$room' }, '$room'],
      ['link', { kind: 'name', name: 'Attic' }, '"Attic"'],
      ['watch', { kind: 'name', name: 'Roof' }, '"Roof"'],
      ['watch', { kind: 'name', name: 'Hint' }, '"Hint"'],
      ['dialog', { kind: 'name', name: 'Basement' }, 'Basement'],
    ]);
  });

  it('returns references in source order whatever the order of keywords (#277)', () => {
    const src = '{watch "$x" dialog "B" goto "A"}';
    const found = refs(src);
    expect(found.map((r) => at(src, r))).toEqual(['"B"', '"A"']);
    expect(found[0]!.start).toBeLessThan(found[1]!.start);
  });

  it.each([
    ['an escaped name', '{watch "x" goto "H\\"all"}', '"H\\"all"', 'H"all'],
    [
      'a name also in the condition',
      '{watch "$x == \'a\'" goto "a"}',
      '"a"',
      'a',
    ],
    ['a name after the keyword', '{watch "x" goto"Hall"}', '"Hall"', 'Hall'],
    ['a quoted {dialog} body', '{dialog "T"}"Hall"{/dialog}', '"Hall"', 'Hall'],
    [
      'a spaced {dialog} body',
      "{dialog 'T'}\n 'Hall' \n{/dialog}",
      "'Hall'",
      'Hall',
    ],
    ['a {goto} name with spaces', '{goto   "Hall"  }', '"Hall"', 'Hall'],
    ['a macro named as its argument', '{goto goto}', 'goto', undefined],
  ])('spans %s as written, quotes included (#260)', (_, src, written, name) => {
    const [ref, ...rest] = refs(src);
    expect(rest).toEqual([]);
    expect(at(src, ref!)).toBe(written);
    expect(ref!.target).toEqual(
      name === undefined
        ? { kind: 'expression', expression: written }
        : { kind: 'name', name },
    );
  });

  it.each([
    ['[[Hall->Hall]]', 8],
    ['[[Hall|Hall]]', 7],
    ['[[Hall<-Hall]]', 2],
    ['[[ Hall | Hall ]]', 10],
    ['[[.c#i Hall->Hall]]', 13],
  ])(
    'spans the target of %s, not a label with its text (#261)',
    (src, start) => {
      expect(refs(src)).toEqual([
        {
          macro: 'link',
          target: { kind: 'name', name: 'Hall' },
          start,
          end: start + 4,
        },
      ]);
    },
  );

  it('gives one reference per argument (#260)', () => {
    const n = 2000;
    const src = '{goto "Hall"} {include $room} [[Hall]] '.repeat(n);
    const found = refs(src);
    expect(found).toHaveLength(3 * n);
    expect(new Set(found.map((r) => r.start)).size).toBe(3 * n);
  });

  it('reads half-typed markup', () => {
    const src = '[[Go->Hall]] {goto "Cellar"} {goto "Att';
    expect(refs(src).map((r) => at(src, r))).toEqual(['Hall', '"Cellar"']);
  });
});

describe('widgetDefinitions (#462)', () => {
  const widgets = (content: string, name = 'Widgets') =>
    widgetDefinitions([{ name, tags: ['widget'], content }]);

  it('reads the name, parameters and offsets of a definition', () => {
    const content = '{widget "Box" @a @b}<b>{@children}</b>{/widget}';
    const [def] = widgets(content);
    expect(def).toMatchObject({
      name: 'Box',
      params: ['@a', '@b'],
      block: true,
      passage: 'Widgets',
      start: 0,
      end: content.indexOf('<b>'),
      closeStart: content.indexOf('{/widget}'),
    });
    expect(content.slice(def!.nameStart, def!.nameEnd)).toBe('Box');
  });

  it.each([
    ['double quotes', '{widget "Two words" @p}x{/widget}', 'Two words'],
    ['single quotes', "{widget 'single' @p}x{/widget}", 'single'],
    ['a bare name', '{widget bare @p}x{/widget}', 'bare'],
  ])('reads %s', (_, content, name) => {
    const [def] = widgets(content);
    expect(def!.name).toBe(name);
    expect(content.slice(def!.nameStart, def!.nameEnd)).toBe(name);
  });

  it('ignores parameters that do not start with @', () => {
    expect(widgets('{widget "W" $x @y z}a{/widget}')[0]!.params).toEqual([
      '@y',
    ]);
  });

  it('takes only StoryInit and passages tagged widget', () => {
    const content = '{widget "A"}a{/widget}';
    expect(widgetDefinitions([{ name: 'Other', content }])).toEqual([]);
    expect(widgetDefinitions([{ name: 'StoryInit', content }])).toHaveLength(1);
  });

  it('does not count {@children} in comments or {do} bodies', () => {
    expect(
      widgets('{widget "A"}<!-- {@children} -->a{/widget}')[0]!.block,
    ).toBe(false);
    expect(
      widgets('{widget "A"}{do}"{@children}"{/do}a{/widget}')[0]!.block,
    ).toBe(false);
  });

  it('gives {@children} to the innermost nested definition', () => {
    const defs = widgets(
      '{widget "Outer"}{widget "Inner"}{@children}{/widget}{/widget}',
    );
    expect(defs.map((d) => [d.name, d.block])).toEqual([
      ['Outer', false],
      ['Inner', true],
    ]);
    expect(defs[1]!.start).toBeGreaterThan(defs[0]!.start);
  });

  it('reports a half-typed definition without a closer', () => {
    const [def] = widgets('{widget "Open"}{@children}');
    expect(def).toMatchObject({ name: 'Open', block: true });
    expect(def!.closeStart).toBeUndefined();
  });

  it('counts offsets in UTF-16 units across CRLF and multibyte text', () => {
    const content = '\r\n😀 {widget "Wé😀" @p}x{/widget}';
    const [def] = widgets(content);
    expect(content.slice(def!.start, def!.end)).toBe('{widget "Wé😀" @p}');
    expect(content.slice(def!.nameStart, def!.nameEnd)).toBe('Wé😀');
    expect(content.slice(def!.closeStart)).toBe('{/widget}');
  });

  it('reads a {@children} in an attribute through the given macros', () => {
    const content = '{widget "A"}{button "{@children}"}x{/button}{/widget}';
    const macros = getMacroRegistry();
    const [def] = widgetDefinitions(
      [{ name: 'Widgets', tags: ['widget'], content }],
      macros,
    );
    expect(def!.block).toBe(true);
  });

  it('parseWidgetDef reads the arguments alone', () => {
    expect(parseWidgetDef('"Box" @a')).toEqual({ name: 'Box', params: ['@a'] });
  });

  it.each([
    ['spaces', '"Box" @a @b'],
    ['commas', '"Box" @a, @b'],
    ['commas and no spaces', '"Box" @a,@b,'],
  ])('reads parameters separated by %s (#470)', (_, rawArgs) => {
    expect(parseWidgetDef(rawArgs)).toEqual({
      name: 'Box',
      params: ['@a', '@b'],
    });
    // The {widget} macro registers what parseWidgetDef reads
    const [def] = widgets(`{widget ${rawArgs}}{@a}{/widget}`);
    expect(def!.params).toEqual(['@a', '@b']);
  });

  it('counts a {@children} in an attribute value, as the docs say (#467)', () => {
    const macros = getMacroRegistry();
    const block = (content: string) =>
      widgetDefinitions(
        [{ name: 'Widgets', tags: ['widget'], content }],
        macros,
      )[0]!.block;
    expect(block('{widget "A"}<p title="{@children}">x</p>{/widget}')).toBe(
      true,
    );
    expect(block('{widget "A"}<p title=\'{@children}\'>x</p>{/widget}')).toBe(
      true,
    );
    expect(block('{widget "A"}<p title={@children}>x</p>{/widget}')).toBe(true);
    expect(block('{widget "B"}{button "{@children}"}x{/button}{/widget}')).toBe(
      true,
    );
    expect(block('{widget "C"}<p title="plain">x</p>{/widget}')).toBe(false);
    // The runtime reads the same markup the same way
    expect(
      astContainsChildren(parseMarkup('<p title="{@children}">x</p>')),
    ).toBe(true);
  });
});

describe('variable references (#464)', () => {
  const macros = getMacroRegistry();
  const refs = (source: string) =>
    variableReferences(source, macros).map((r) => ({
      text: source.slice(r.start, r.end),
      sigil: r.sigil,
      name: r.name,
      path: r.path,
    }));
  const declare = (variables: string, transients = '') => {
    const read = (content: string, sigil?: '$' | '%') =>
      new Map(
        parseDeclarations(content, sigil).declarations.map((d) => [
          d.name,
          d.schema,
        ]),
      );
    return {
      variables: read(variables),
      ...(transients ? { transients: read(transients, '%') } : {}),
    };
  };
  const check = (content: string, declared = declare('$a = 1')) =>
    validateVariableReferences([{ name: 'P', content }], declared, macros);

  it('finds references with their sigil, path and span', () => {
    expect(refs('x {$a.b.c} {print $d + %e.f} {set $g = 1}')).toEqual([
      { text: '$a.b.c', sigil: '$', name: 'a', path: ['b', 'c'] },
      { text: '$d', sigil: '$', name: 'd', path: [] },
      { text: '%e.f', sigil: '%', name: 'e', path: ['f'] },
      { text: '$g', sigil: '$', name: 'g', path: [] },
    ]);
  });

  it('finds references in labels, attributes, selectors and bound names', () => {
    expect(
      refs(
        '{button "Go {$a}"}x{/button} <p title="{$b}" onclick="{$c}">x</p> ' +
          '{.{$d} span}x{/span} {textbox "$e"} [[Link {$f}->Hall]]',
      ).map((r) => r.text),
    ).toEqual(['$a', '$b', '$c', '$d', '$e', '$f']);
  });

  it('finds references in {do} bodies and conditions, not in strings', () => {
    expect(
      refs('{do}$a = "$b" + $c; // $d\n{/do}{if $e > 1}x{/if}').map(
        (r) => r.text,
      ),
    ).toEqual(['$a', '$c', '$e']);
  });

  it('never takes _ and @ locals for variables', () => {
    expect(refs('{set _t = 1}{$x} {_t} {@l} {for @i of $list}{/for}')).toEqual([
      { text: '$x', sigil: '$', name: 'x', path: [] },
      { text: '$list', sigil: '$', name: 'list', path: [] },
    ]);
    expect(check('{_t}{@l}{set _u = 1}')).toEqual([]);
  });

  it('reports undeclared variables and transients with their spans', () => {
    const content = 'Hi {$a} {$missing.x} {%t}';
    const declared = declare('$a = 1', '%u = 1');
    const found = check(content, declared);
    expect(
      found.map((d) => [d.code, d.name, content.slice(d.start, d.end)]),
    ).toEqual([
      ['undeclared-variable', 'missing', '$missing.x'],
      ['undeclared-transient', 't', '%t'],
    ]);
    expect(found[0]).toMatchObject({
      passage: 'P',
      path: ['x'],
      message: 'Undeclared variable: $missing.x',
    });
    // Transients are not checked unless given
    expect(check(content).map((d) => d.name)).toEqual(['missing']);
  });

  it('checks {set} targets, as the story start does, but not {unset} ones', () => {
    expect(check('{set $no = 1}{unset $no2}').map((d) => d.name)).toEqual([
      'no',
    ]);
  });

  it('checks fields against the declared schema', () => {
    const declared = declare(
      '$n = 1\n$s = "x"\n$arr = []\n$o = { a: { b: 1 }, "q-k": 2 }\n$nil = null\n$calc = Math.PI',
    );
    const ok = [
      '{$n.toFixed}',
      '{$s.length}',
      '{$arr.length}',
      '{$arr.anything.deeper}',
      '{$o.a.b}',
      '{$o.unknown}',
      '{$nil.any}',
      '{$calc.whatever}',
      '{$o?.a}',
      '{$o["q-k"]}',
    ];
    for (const content of ok)
      expect(check(content, declared), content).toEqual([]);
    const bad = check('{$n.nope} {$o.a.b.c}', declared);
    expect(bad.map((d) => [d.code, d.message])).toEqual([
      ['primitive-field', 'Cannot access field "nope" on $n (type: number)'],
      ['primitive-field', 'Cannot access field "c" on $o.a.b (type: number)'],
    ]);
  });

  it('reads destructuring and shorthand', () => {
    expect(
      refs('{do}const { x } = $o; const p = { $a };{/do}').map((r) => r.text),
    ).toEqual(['$o', '$a']);
  });

  it('reports a reserved name', () => {
    expect(check('{$__proto__}')[0]).toMatchObject({ code: 'reserved-name' });
  });

  it('skips script and stylesheet passages and declarations', () => {
    expect(
      validateVariableReferences(
        [
          { name: 'S', tags: ['script'], content: '$nope' },
          { name: 'StoryVariables', content: '$nope = 1' },
        ],
        declare('$a = 1'),
        macros,
      ),
    ).toEqual([]);
  });

  it('reads half-typed markup, skipping malformed tags', () => {
    const content = '{$a} {if $b >} {$c} {broken';
    expect(check(content).map((d) => d.name)).toEqual(['b', 'c']);
  });

  it('gives offsets in UTF-16 units across CRLF and multibyte text', () => {
    const content = '\r\n😀 é {$ünd}\r\n{$ok}\r\n{button "😀 {$no}"}x{/button}';
    const found = check(content, declare('$ok = 1'));
    expect(found.map((d) => content.slice(d.start, d.end))).toEqual(['$no']);
    expect(variableReferences('😀 {$a}', macros)[0]).toMatchObject({
      start: 4,
      end: 6,
    });
  });

  it('places a reference in a string with escapes', () => {
    const content = '{button "say \\"hi\\" {$gone}"}x{/button}';
    const found = check(content);
    expect(found.map((d) => content.slice(d.start, d.end))).toEqual(['$gone']);
  });

  it('is what the story start reports, with the same messages', () => {
    const content = '{$a.nope} {$undeclared} {textbox "$undeclared2"}';
    const messages = check(content, declare('$a = 1')).map((d) => d.message);
    const passages = new Map([
      ['P', { pid: 1, name: 'P', tags: [], metadata: {}, content }],
    ]);
    expect(
      validatePassages(passages, parseStoryVariables('$a = 1')).map((e) =>
        e.replace('Passage "P": ', ''),
      ),
    ).toEqual(messages);
  });
});

describe('all variable references (#468)', () => {
  const macros = getMacroRegistry();
  const texts = (source: string, all?: boolean) =>
    variableReferences(source, macros, { all }).map((r) =>
      source.slice(r.start, r.end),
    );

  it('has the receivers of {unset} and {computed} with all', () => {
    const source =
      '{unset $a}{unset $b.c}{unset _t}{unset %tr}{computed $d = $e + 1}{computed _u = $f}';
    expect(texts(source)).toEqual(['$e', '$f']);
    expect(texts(source, true)).toEqual([
      '$a',
      '$b.c',
      '%tr',
      '$d',
      '$e',
      '$f',
    ]);
  });

  it('has the references in the selectors of links, displays and expressions', () => {
    const source =
      '[[.c{$a} Go->T]] {.k{$b} $v} {.q{$d} $e + 1} {.{$cls} button "x"}y{/button}';
    expect(texts(source)).toEqual(['$v', '$e', '$cls']);
    expect(texts(source, true)).toEqual(['$a', '$b', '$v', '$d', '$e', '$cls']);
  });

  it('is the story start list, in order, as a part of the whole', () => {
    const source =
      '{unset $x}{$a} [[.c{$s} Go->T]] {set $b = 1} {computed $z = $a}';
    const checked = variableReferences(source, macros);
    const all = variableReferences(source, macros, { all: true });
    expect(all.length).toBeGreaterThan(checked.length);
    let from = 0;
    for (const ref of checked) {
      from = all.findIndex(
        (other, i) => i >= from && other.start === ref.start,
      );
      expect(from).toBeGreaterThanOrEqual(0);
    }
    expect(all.map((r) => r.start)).toEqual(
      [...all.map((r) => r.start)].sort((a, b) => a - b),
    );
  });

  it('is not what validateVariableReferences checks', () => {
    const declared = { variables: new Map([['a', undefined]]) };
    expect(
      validateVariableReferences(
        [{ name: 'P', content: '{unset $gone} [[.c{$gone2} Go->T]]' }],
        declared,
        macros,
      ),
    ).toEqual([]);
  });

  it('reads no receiver from arguments that do not parse', () => {
    expect(texts('{unset}{unset "$a"}', true)).toEqual([]);
  });
});

describe('discoverMacros (#468)', () => {
  const source = `
// Story.defineMacro({ name: "commented" })
const s = 'Story.defineMacro({ name: "in-a-string" })';
Story.defineMacro({
  name: "alert",
  block: true,
  interpolate: true,
  description: \`A box\`,
  subMacros: ["a", 'b', x, "c"],
  parameters: [
    { name: "label", type: "string", holds: "markup", required: true },
    { name: 'opts', type: 'options', parameters: [{ name: 'size', type: 'number' }] },
    { name: "code", type: "expression" }
  ],
  render(props, ctx) { return ctx.h("div", { class: "x" }, "}"); },
});
const counter = { name: 'counter', storeVar: true, parameters: [{ name: 'v', type: 'variable' }], render: (p) => null };
defineMacro(counter);
Story.defineMacro({ name: dynamic, block: true });
Story.defineMacro({ name: "bad", parameters: [{ name: "x", type: "nope" }] });
Story.defineMacro({ name: "dyn", parameters: [{ name: n, type: "text" }], block: false, subMacros: ["z"] });
function f() { Story.defineMacro({ name: "nested", subMacros: ["inner"] }) }
Story.defineMacro({ name: "half", block: tr
`;

  it('reads the literal parts of each call, in order', () => {
    const macros = discoverMacros(source);
    expect(macros.map((m) => m.name)).toEqual([
      'alert',
      'counter',
      'bad',
      'dyn',
      'nested',
    ]);
    expect(macros[0]).toMatchObject({
      name: 'alert',
      block: true,
      interpolate: true,
      description: 'A box',
      subMacros: ['a', 'b', 'c'],
      parameters: [
        { name: 'label', type: 'string', holds: 'markup', required: true },
        {
          name: 'opts',
          type: 'options',
          parameters: [{ name: 'size', type: 'number' }],
        },
        { name: 'code', type: 'expression' },
      ],
    });
    expect(macros[1]).toMatchObject({
      name: 'counter',
      block: false,
      storeVar: true,
      parameters: [{ name: 'v', type: 'variable' }],
    });
  });

  it('says where the name is written', () => {
    for (const macro of discoverMacros(source)) {
      expect(source.slice(macro.nameStart, macro.nameEnd)).toBe(macro.name);
    }
  });

  it('skips what is not static', () => {
    const [, , bad, dyn, nested] = discoverMacros(source);
    // A parameter defineMacro refuses, or that is not written out: none
    expect(bad!.parameters).toBeUndefined();
    expect(dyn!.parameters).toBeUndefined();
    expect(dyn).toMatchObject({ block: false, subMacros: ['z'] });
    // Sub-macros make a macro a block unless it says it is not
    expect(nested!.block).toBe(true);
  });

  it('gives macros that validateStoryMarkup takes', () => {
    const macros = discoverMacros(
      'Story.defineMacro({ name: "alert", block: true, render() {} })',
    );
    const passages = [{ name: 'P', content: '{alert}x{/alert}' }];
    expect(validateStoryMarkup(passages, macros)).toEqual([]);
    // Without it, the closer closes nothing
    expect(validateStoryMarkup(passages, []).map((d) => d.code)).toEqual([
      'stray-closer',
    ]);
  });

  it('reads nothing from text without a call, and never throws', () => {
    for (const text of [
      '',
      'defineMacro',
      'defineMacro(',
      'defineMacro({',
      'defineMacro({ name: ',
      'defineMacro({ name: "x", parameters: [ {',
      'Story.defineMacro(config)',
      'defineMacro({ ...base, name: "x" })',
      '`${defineMacro({ name: "t" })}`',
    ]) {
      expect(() => discoverMacros(text)).not.toThrow();
    }
    expect(discoverMacros('defineMacro({ name: "t" })')).toHaveLength(1);
    expect(discoverMacros('{ ...base, name: "x" }')).toEqual([]);
  });
});

describe('validateStoryMarkup tolerant (#469)', () => {
  const macros = getMacroRegistry();
  const content = [
    '{if $a}', // 1: unclosed block
    'hi',
    '{nosuch}', // 3: unknown macro
    '[[Gone]]', // 4: unknown passage
    '{print $x + }', // 5: bad expression
  ].join('\n');
  const codes = (
    passages: { name: string; content: string }[],
    tolerant?: boolean,
  ) =>
    validateStoryMarkup(passages, macros, { tolerant }).map(
      (d) => `${d.line}:${d.code}`,
    );

  it('reports every problem of a passage', () => {
    expect(codes([{ name: 'P', content }], true)).toEqual(
      expect.arrayContaining([
        '1:unclosed-block',
        '3:unknown-macro',
        '4:unknown-passage',
        '5:code-syntax',
      ]),
    );
    expect(codes([{ name: 'P', content }], true)).toHaveLength(4);
  });

  it('changes nothing without the option', () => {
    expect(codes([{ name: 'P', content }])).toEqual(['1:unclosed-block']);
    expect(codes([{ name: 'P', content }], false)).toEqual([
      '1:unclosed-block',
    ]);
  });

  it('goes past a malformed tag, with the same codes and spans', () => {
    const text = 'a {$x\n{nosuch}\n<div>';
    const strict = validateStoryMarkup([{ name: 'P', content: text }], macros);
    expect(strict.map((d) => d.code)).toEqual(['unclosed-expression']);
    const all = validateStoryMarkup([{ name: 'P', content: text }], macros, {
      tolerant: true,
    });
    expect(all[0]).toEqual(strict[0]);
    expect(all.map((d) => d.code).sort()).toEqual([
      'unclosed-block',
      'unclosed-expression',
      'unknown-macro',
    ]);
  });

  it('gives the same diagnostics for well-formed markup', () => {
    const passages = [
      { name: 'P', content: '{nosuch} [[Q]] {print 1 +}' },
      { name: 'Q', content: '{if $a}x{/if}' },
    ];
    expect(validateStoryMarkup(passages, macros, { tolerant: true })).toEqual(
      validateStoryMarkup(passages, macros),
    );
  });

  it('reads the widgets of a passage with a malformed tag', () => {
    const passages = [
      {
        name: 'W',
        tags: ['widget'],
        content: '{widget "Box"}x{/widget} {oops',
      },
      { name: 'P', content: '{Box}' },
    ];
    expect(codes(passages, true)).toEqual(['1:unclosed-macro']);
  });
});
