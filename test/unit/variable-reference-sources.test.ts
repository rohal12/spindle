/**
 * Variable-reference validation and source mapping (#495, #496, #500-#503).
 */
import { describe, it, expect } from 'vitest';
import { getMacroRegistry } from '../../src/registry';
import { lexJs } from '../../src/js-lexer';
import { sigilExpressions } from '../../src/code-check';
import {
  parseStoryVariables,
  validatePassages,
} from '../../src/story-variables';
import {
  parseDeclarations,
  validateStoryMarkup,
  validateVariableReferences,
  variableReferences,
} from '../../src/tooling';

const macros = getMacroRegistry();
/** The start of a JavaScript unicode escape, written out. */
const U = '\\' + 'u';

const declare = (variables: string) => ({
  variables: new Map(
    parseDeclarations(variables).declarations.map((d) => [d.name, d.schema]),
  ),
});

describe('computed unset receivers (#666)', () => {
  it.each([
    ['{unset $items[$idx]}', ['items', 'idx'], ['idx']],
    [
      '{unset $items[$indexes[$idx]]}',
      ['items', 'indexes', 'idx'],
      ['indexes', 'idx'],
    ],
    [String.raw`{unset $\u0078}`, ['x'], []],
    ['{unset _items[%idx]}', ['idx'], ['idx']],
  ])('collects receiver and index references in %s', (source, all, reads) => {
    expect(
      variableReferences(source, macros, { all: true }).map((r) => r.name),
    ).toEqual(all);
    expect(variableReferences(source, macros).map((r) => r.name)).toEqual(
      reads,
    );
    for (const ref of variableReferences(source, macros, { all: true })) {
      expect(source.slice(ref.start, ref.end)).toMatch(/^[$%]/);
    }
  });

  it('reports undeclared reads in an unset index', () => {
    expect(
      validateVariableReferences(
        [{ name: 'Start', content: '{unset $items[$missing]}' }],
        declare('$items = [1, 2]'),
        macros,
      ),
    ).toMatchObject([{ code: 'undeclared-variable', name: 'missing' }]);
  });
});

describe('escaped member identifiers (#668)', () => {
  it.each([
    [String.raw`$s.len\u0067th`, ['length']],
    [String.raw`$s.to\u0055pperCase()`, ['toUpperCase']],
    [String.raw`$obj.f\u{69}eld.v\u0061lue`, ['field', 'value']],
  ])('decodes %s and retains its written span', (expr, path) => {
    const source = `{print ${expr}}`;
    const [ref] = variableReferences(source, macros);
    expect(ref!.path).toEqual(path);
    expect(source.slice(ref!.start, ref!.end)).toBe(expr.replace(/\(\)$/, ''));
    expect(
      validateVariableReferences(
        [{ name: 'Start', content: source }],
        declare('$s = "abc"\n$obj = {field: {value: 42}}'),
        macros,
      ),
    ).toEqual([]);
  });
});

describe('code attribute interpolation offsets (#495)', () => {
  it('points sigilExpressions at the live interpolation', () => {
    expect(sigilExpressions('console.log("$name"); {$name}')).toEqual([
      { expr: '$name', at: 23 },
    ]);
  });

  it('advances across literal text and verbatim blocks before an expression', () => {
    const value = '{$(1)} x {$a} {$(2)} {$a}';
    expect(sigilExpressions(value).map((e) => e.at)).toEqual([
      value.indexOf('{$a}') + 1,
      value.lastIndexOf('{$a}') + 1,
    ]);
  });

  it('gives the reference range of the live interpolation', () => {
    const source = `<button onclick="console.log('$name'); {$name}">x</button>`;
    const [ref] = variableReferences(source, macros);
    expect(ref!.start).toBe(source.lastIndexOf('$name'));
    expect(ref!.end).toBe(source.lastIndexOf('$name') + '$name'.length);
    const all = variableReferences(source, macros, { all: true });
    expect(all.map((r) => r.start)).toEqual([source.lastIndexOf('$name')]);
  });

  it('points the code diagnostic at the live interpolation', () => {
    const source = `<b onclick="f('$a +'); {$a +}">x</b>`;
    const [diagnostic] = validateStoryMarkup(
      [{ name: 'Start', content: source }],
      macros,
    );
    expect(diagnostic!.start).toBe(source.indexOf('+}') + 1);
  });
});

describe('escaped variable identifiers (#500)', () => {
  const check = (content: string, variables = '$foo = 123') =>
    validateVariableReferences(
      [{ name: 'Start', content }],
      declare(variables),
      macros,
    );

  it('validates a reference spelled with an escape by its decoded name', () => {
    expect(check(String.raw`{($fo${U}006f)}`)).toEqual([]);
  });

  it('gives the decoded name and the whole spelling', () => {
    const source = String.raw`{($fo${U}006f.bar)}`;
    const [ref] = variableReferences(source, macros);
    expect(ref).toMatchObject({ name: 'foo', path: ['bar'] });
    expect(source.slice(ref!.start, ref!.end)).toBe(
      String.raw`$fo${U}006f.bar`,
    );
  });

  it('reports an undeclared escaped name by its decoded name', () => {
    const source = String.raw`{($ba${U}0072)}`;
    const [d] = check(source);
    expect(d).toMatchObject({ code: 'undeclared-variable', name: 'bar' });
    expect(source.slice(d!.start, d!.end)).toBe(String.raw`$ba${U}0072`);
    expect(d!.message).toBe('Undeclared variable: $bar');
  });

  it('does the same in code that does not parse', () => {
    const source = String.raw`{($fo${U}006f + )}`;
    const [ref] = variableReferences(source, macros);
    expect(ref!.name).toBe('foo');
    expect(source.slice(ref!.start, ref!.end)).toBe(String.raw`$fo${U}006f`);
  });
});

describe('character paths of strings (#502)', () => {
  const errors = (content: string, variables: string) =>
    validatePassages(
      new Map([['P', { pid: 1, name: 'P', tags: [], metadata: {}, content }]]),
      parseStoryVariables(variables),
    );

  it('accepts an index of a string', () => {
    expect(errors('{$name.0}', '$name = "Ada"')).toEqual([]);
    expect(errors('{$name.12}', '$name = "Ada"')).toEqual([]);
    expect(errors('{$name.0.0}', '$name = "Ada"')).toEqual([]);
    expect(errors('{$name.0.length}', '$name = "Ada"')).toEqual([]);
  });

  it('still rejects what a string does not have', () => {
    expect(errors('{$name.x}', '$name = "Ada"')).toHaveLength(1);
    expect(errors('{$name.01}', '$name = "Ada"')).toHaveLength(1);
    expect(errors('{$n.0}', '$n = 5')).toHaveLength(1);
    expect(errors('{$b.0}', '$b = true')).toHaveLength(1);
  });
});

describe('variable references in source order (#503)', () => {
  const order = (source: string, all?: boolean) =>
    variableReferences(source, macros, { all }).map((r) => [r.name, r.start]);

  it('puts a selector before the arguments after it', () => {
    expect(order('{.{$class} print $value}')).toEqual([
      ['class', 3],
      ['value', 17],
    ]);
    expect(order('{.{$class} print $value}', true)).toEqual([
      ['class', 3],
      ['value', 17],
    ]);
  });

  it('orders every collector output, bindings and arguments included', () => {
    const sources = [
      '{.{$c} textbox "$name" $v}',
      '{unset $a}{.{$c} set $b = $d}[[.{$e} Go->T]]',
      '<p title="{$z}">{.{$c} print $v}</p>',
    ];
    for (const source of sources) {
      for (const all of [false, true]) {
        const starts = variableReferences(source, [...macros], { all }).map(
          (r) => r.start,
        );
        expect(starts).toEqual([...starts].sort((a, b) => a - b));
      }
    }
  });

  it('orders the diagnostics of the story start the same way', () => {
    const diagnostics = validateVariableReferences(
      [{ name: 'P', content: '{.{$class} print $value}' }],
      { variables: new Map() },
      macros,
    );
    expect(diagnostics.map((d) => d.name)).toEqual(['class', 'value']);
  });
});

describe('the names lexJs reports (#500)', () => {
  it('gives the name JavaScript reads and where the spelling ends', () => {
    const src = String.raw`$fo${U}006f + $bar`;
    const seen: [string, string, number, number][] = [];
    lexJs(src, {
      variable: (sigil, name, index, _nesting, end) =>
        seen.push([sigil, name, index, end]),
    });
    expect(seen).toEqual([
      ['$', 'foo', 0, 9],
      ['$', 'bar', 12, 16],
    ]);
  });
});
