import { describe, it, expect, beforeAll } from 'vitest';
import { checkPassageCode } from '../../src/code-check';
import {
  parseStoryVariables,
  validatePassages,
} from '../../src/story-variables';
import type { Passage } from '../../src/parser';
import type { MacroMetadata } from '../../src/registry';
import { getMacroRegistry } from '../../src/registry';

/** The syntax errors `checkPassageCode` reports for a passage. */
function errors(content: string, macros?: readonly MacroMetadata[]): string[] {
  const out: string[] = [];
  checkPassageCode(content, (m) => out.push(m), macros ? { macros } : {});
  return out;
}

beforeAll(() => {
  // The built-in macros (registered by the test setup) declare parameters
  expect(getMacroRegistry().some((m) => m.name === 'computed')).toBe(true);
});

describe('checkPassageCode', () => {
  // What authors see at story start for typical mistakes: the line and
  // column in the passage, what is wrong, and the block it is in.
  it.each([
    [
      'You have {if $gold > }plenty{/if} of gold.',
      'line 1, column 21: Unexpected end of code in {if $gold >}',
    ],
    [
      '{set $name = "Bob}\nHello {$name}.',
      'line 1, column 14: Unterminated string constant in {set $name = "Bob}',
    ],
    [
      'Total: {print ($gold + $count}',
      'line 1, column 30: Unexpected end of code (missing ")" for the "(" at line 1, column 15) in {print ($gold + $count}',
    ],
    [
      'Name: {$name.toUpperCase(}',
      'line 1, column 26: Unexpected end of code (missing ")" for the "(" at line 1, column 25) in {$name.toUpperCase(}',
    ],
    [
      '{do}\nif ($gold < 10 {\n  $gold = 10;\n}\n{/do}',
      'line 2, column 16: Unexpected "{" (missing ")" for the "(" at line 2, column 4) in {do}',
    ],
    [
      '{do}\n$list.push("rope";\n{/do}',
      'line 2, column 18: Unexpected ";" (missing ")" for the "(" at line 2, column 11) in {do}',
    ],
    [
      'Both: {print $gold $count}',
      'line 1, column 20: Unexpected "$count" in {print $gold $count}',
    ],
    [
      '{do}\nconst o = { a: 1\n  b: 2 };\n{/do}',
      'line 3, column 3: Unexpected "b" in {do}',
    ],
    [
      '{set $count = $count ++ 1}',
      'line 1, column 25: Unexpected "1" in {set $count = $count ++ 1}',
    ],
    [
      '{set $list = [1, 2}',
      'line 1, column 19: Unexpected end of code (missing "]" for the "[" at line 1, column 14) in {set $list = [1, 2}',
    ],
    [
      "{if $name == Bob's}yes{/if}",
      "line 1, column 17: Unterminated string constant in {if $name == Bob's}",
    ],
    // The `{set …}` the author wrote, not a `{$name`}` inside it
    [
      '{set $name = `Hi ${$name`}',
      'line 1, column 26: Unterminated template literal (missing "}" for the "${" at line 1, column 18) in {set $name = `Hi ${$name`}',
    ],
  ])('%j', (content, message) => {
    expect(errors(content)).toEqual([message]);
  });

  it('accepts well-formed code', () => {
    expect(
      errors(
        '{set $x = 1; $y = [1, 2]}{if $x > 0}a{elseif $y}b{/if}{print $x}' +
          '{do}if ($x) { $y.push(3) }{/do}{$y.length}' +
          '{switch $x}{case 1, 2}one{/switch}',
      ),
    ).toEqual([]);
  });

  it('checks the code arguments of built-in macros', () => {
    expect(errors('{computed _total = $a + }')).toEqual([
      'line 1, column 24: Unexpected end of code in {computed _total = $a +}',
    ]);
    expect(errors('{for @item, @i of $list.filter(}x{/for}')).toEqual([
      'line 1, column 32: Unexpected end of code (missing ")" for the "(" at line 1, column 31) in {for @item, @i of $list.filter(}',
    ]);
    expect(errors('{meter ($hp $max "HP"}')).toEqual([
      'line 1, column 13: Unexpected "$max" in {meter ($hp $max "HP"}',
    ]);
  });

  it("checks {watch}'s condition and run action, code in quoted strings", () => {
    expect(errors('{watch "$gold >" run "$x = "}')).toEqual([
      'line 1, column 16: Unexpected end of code in {watch "$gold >" run "$x = "}',
      'line 1, column 28: Unexpected end of code in {watch "$gold >" run "$x = "}',
    ]);
    expect(errors('{watch "$gold > 5" run "$x = 1"}')).toEqual([]);
  });

  it('checks markup in quoted labels and HTML attribute values', () => {
    expect(
      errors('{button "Count: {$count + }"}{set $c = 1}{/button}'),
    ).toEqual(['line 1, column 27: Unexpected end of code in {$count + }']);
    expect(
      errors('<b class="{if $lit >}on{/if}" onclick="{$x +}">b</b>'),
    ).toEqual([
      'line 1, column 21: Unexpected end of code in {if $lit >}',
      'line 1, column 45: Unexpected end of code in {$x +} in onclick',
    ]);
  });

  it('leaves passage names, text and the names of widget parameters alone', () => {
    expect(
      errors(
        "{goto Bob's room}{include Al's}{link Don't go}" +
          '{widget "Card" @title @body}x{/widget}' +
          '{link "Go" "Room"}{textbox "$name" "Your name"}',
      ),
    ).toEqual([]);
  });

  it('checks the expression and statements arguments of custom macros', () => {
    const macros: MacroMetadata[] = [
      {
        name: 'damage',
        block: false,
        subMacros: [],
        source: 'user',
        parameters: [{ name: 'target', type: 'variable' }, { name: 'amount' }],
      },
      {
        name: 'later',
        block: false,
        subMacros: [],
        source: 'user',
        parameters: [
          { name: 'label', type: 'text' },
          { name: 'code', type: 'statements' },
        ],
      },
      { name: 'free', block: false, subMacros: [], source: 'user' },
    ];
    expect(errors('{damage $hp $str *}', macros)).toEqual([
      'line 1, column 19: Unexpected end of code in {damage $hp $str *}',
    ]);
    expect(errors('{later "Soon" $x = ; $y = 2}', macros)).toEqual([
      'line 1, column 20: Unexpected ";" in {later "Soon" $x = ; $y = 2}',
    ]);
    expect(errors("{free Don't (}", macros)).toEqual([]);
  });
});

describe('validatePassages', () => {
  const schema = parseStoryVariables('$gold = 5\n$name = "Ann"');
  const passages = (content: string) =>
    new Map<string, Passage>([
      ['Shop', { pid: 1, name: 'Shop', tags: [], metadata: {}, content }],
    ]);

  it('reports syntax errors with the passage, beside undeclared variables', () => {
    expect(
      validatePassages(passages('{print $gold +}\n{$nope}'), schema),
    ).toEqual([
      'Passage "Shop": Undeclared variable: $nope',
      'Passage "Shop" line 1, column 15: Unexpected end of code in {print $gold +}',
    ]);
  });
});
