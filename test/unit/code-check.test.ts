/**
 * The story-start check of the code in passages (code-check.ts), run as
 * part of the markup check (markup/validate.ts).
 */
import { describe, it, expect } from 'vitest';
import { formatDiagnostic, validateMarkup } from '../../src/markup/validate';
import { validateStoryMarkup } from '../../src/tooling';
import {
  getMacro,
  getMacroRegistry,
  isSubMacro,
  type MacroMetadata,
} from '../../src/registry';

/**
 * The errors the story-start check reports for a story of these passages,
 * by name.
 */
function storyErrors(
  passages: Record<string, string>,
  extra: MacroMetadata[] = [],
): string[] {
  const macros = [...getMacroRegistry(), ...extra];
  const parameters = new Map(
    macros.map((m) => [m.name.toLowerCase(), m.parameters]),
  );
  const known = new Set(macros.map((m) => m.name.toLowerCase()));
  const list = Object.entries(passages).map(([name, content]) => ({
    name,
    content,
  }));
  return validateMarkup(list, {
    isKnownMacro: (name) =>
      !!getMacro(name) || isSubMacro(name) || known.has(name),
    macroNames: known,
    parametersOf: (name) => parameters.get(name),
  }).map(formatDiagnostic);
}

/** The errors the story-start check reports for a passage, Shop. */
function errors(content: string, extra: MacroMetadata[] = []): string[] {
  return storyErrors({ Shop: content }, extra);
}

describe('the story-start code check', () => {
  // What authors see for typical mistakes: the line and column in the
  // passage, what is wrong, and the block it is in.
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
    expect(errors(content)).toEqual([`Passage "Shop", ${message}`]);
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
      'Passage "Shop", line 1, column 24: Unexpected end of code in {computed _total = $a +}',
    ]);
    expect(errors('{for @item, @i of $list.filter(}x{/for}')).toEqual([
      'Passage "Shop", line 1, column 32: Unexpected end of code (missing ")" for the "(" at line 1, column 31) in {for @item, @i of $list.filter(}',
    ]);
    expect(errors('{meter ($hp $max "HP"}')).toEqual([
      'Passage "Shop", line 1, column 13: Unexpected "$max" in {meter ($hp $max "HP"}',
    ]);
  });

  it("checks {watch}'s condition and run action, code in quoted strings", () => {
    expect(errors('{watch "$gold >" run "$x = "}')).toEqual([
      'Passage "Shop", line 1, column 16: Unexpected end of code in {watch "$gold >" run "$x = "}',
      'Passage "Shop", line 1, column 28: Unexpected end of code in {watch "$gold >" run "$x = "}',
    ]);
    expect(errors('{watch "$gold > 5" run "$x = 1"}')).toEqual([]);
  });

  it('checks markup and code in quoted labels and HTML attribute values', () => {
    expect(
      errors('{button "Count: {$count + }"}{set $c = 1}{/button}'),
    ).toEqual([
      'Passage "Shop", line 1, column 27: In the label of {button}: Unexpected end of code in {$count + }',
    ]);
    expect(errors('{button "Count: {$count"}x{/button}')).toEqual([
      'Passage "Shop", line 1, column 17: In the label of {button}: Unclosed {$…: no } ends it',
    ]);
    expect(errors('{link "Go {sett $x}" "Shop"}x{/link}')).toEqual([
      'Passage "Shop", line 1, column 11: In the text of {link}: Unknown macro {sett}. Did you mean {set}?',
    ]);
    expect(
      errors('<b class="{if $lit >}on{/if}" onclick="{$x +}">b</b>'),
    ).toEqual([
      'Passage "Shop", line 1, column 21: In the class attribute of <b>: Unexpected end of code in {if $lit >}',
      'Passage "Shop", line 1, column 45: Unexpected end of code in {$x +} in the onclick attribute of <b>',
    ]);
  });

  it('leaves text and the names of widget parameters alone', () => {
    expect(
      errors(
        "{link Don't go}x{/link}{button Don't panic}x{/button}" +
          '{widget "Card" @title @body}x{/widget}' +
          '{link "Go" "Shop"}x{/link}{textbox "$name" "Your name"}',
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
        parameters: [
          { name: 'target', type: 'variable' },
          { name: 'amount', type: 'expression' },
        ],
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
      'Passage "Shop", line 1, column 19: Unexpected end of code in {damage $hp $str *}',
    ]);
    expect(errors('{later "Soon" $x = ; $y = 2}', macros)).toEqual([
      'Passage "Shop", line 1, column 20: Unexpected ";" in {later "Soon" $x = ; $y = 2}',
    ]);
    expect(errors("{free Don't (}", macros)).toEqual([]);
  });

  it('runs in the tooling check, with the macros it is given', () => {
    const diagnostics = validateStoryMarkup(
      [{ name: 'Shop', content: '{print $gold +}{loot $x +}' }],
      [
        ...getMacroRegistry(),
        {
          name: 'loot',
          block: false,
          subMacros: [],
          parameters: [{ name: 'amount', type: 'expression' }],
        },
      ],
    );
    expect(diagnostics.map(formatDiagnostic)).toEqual([
      'Passage "Shop", line 1, column 15: Unexpected end of code in {print $gold +}',
      'Passage "Shop", line 1, column 26: Unexpected end of code in {loot $x +}',
    ]);
  });
});

describe('the story-start check of passage names', () => {
  const travel: MacroMetadata = {
    name: 'travel',
    block: false,
    subMacros: [],
    source: 'user',
    parameters: [
      { name: 'fast', type: 'flag' },
      { name: 'to', type: 'passage' },
    ],
  };

  /** The errors of Shop, in a story that also has the passage Hall. */
  const inShop = (content: string) =>
    storyErrors({ Hall: '', Shop: content }, [travel]);

  it('accepts quoted names of passages that exist, and expressions', () => {
    expect(
      inShop(
        '{goto "Hall"}{include "Hall"}{include \'Hall\' inline}' +
          '{goto $room}{include _next inline}{goto "Ha" + "ll"}' +
          '{goto $rooms[0]}{goto `Hall`}{travel fast "Hall"}{travel @to}' +
          '[[Hall]] [[Go|Hall]] [[Go->Hall]] [[Hall<-Go]]' +
          '{link "Go" "Hall"}x{/link}{link "Stay"}x{/link}' +
          '{dialog "Map"}Hall{/dialog}{dialog "Map"}{$room}{/dialog}' +
          '{watch "$x" goto "Hall" dialog "Hall"}',
      ),
    ).toEqual([]);
  });

  it.each([
    [
      '{goto Kitchen}',
      'column 7: Unquoted passage name in {goto Kitchen}: write "Kitchen" (a passage name is a quoted string or an expression)',
    ],
    [
      '{include Kitchen inline}',
      'column 10: Unquoted passage name in {include Kitchen inline}: write "Kitchen" (a passage name is a quoted string or an expression)',
    ],
    [
      "{goto Bob's room}",
      "column 10: Unterminated string constant in {goto Bob's room} (a passage name is a quoted string or an expression)",
    ],
    [
      '{include North Hall}',
      'column 16: Unexpected "Hall" in {include North Hall} (a passage name is a quoted string or an expression)',
    ],
    [
      '{travel fast Hall}',
      'column 14: Unquoted passage name in {travel fast Hall}: write "Hall" (a passage name is a quoted string or an expression)',
    ],
  ])('rejects the unquoted passage name in %s', (content, error) => {
    expect(inShop(content)).toEqual([`Passage "Shop", line 1, ${error}`]);
  });

  it.each([
    ['{goto "Kitchen"}', 1, 7, '{goto "Kitchen"}'],
    ['{include "Kitchen"}', 1, 10, '{include "Kitchen"}'],
    ['{include "Kitchen" inline}', 1, 10, '{include "Kitchen" inline}'],
    ['{travel "Kitchen"}', 1, 9, '{travel "Kitchen"}'],
    ['[[Kitchen]]', 1, 3, '[[Kitchen]]'],
    ['[[Cook|Kitchen]]', 1, 8, '[[Cook|Kitchen]]'],
    ['[[Cook->Kitchen]]', 1, 9, '[[Cook->Kitchen]]'],
    ['[[Kitchen<-Cook]]', 1, 3, '[[Kitchen<-Cook]]'],
    ['[[.big#k Kitchen]]', 1, 10, '[[.big#k Kitchen]]'],
    ['{link "Cook" "Kitchen"}x{/link}', 1, 15, '{link "Cook" "Kitchen"}'],
    ['{dialog "Cook"}Kitchen{/dialog}', 1, 16, '{dialog "Cook"}'],
    ["{dialog 'Cook'}\n 'Kitchen' \n{/dialog}", 2, 3, "{dialog 'Cook'}"],
    ['{watch "$x" goto "Kitchen"}', 1, 19, '{watch "$x" goto "Kitchen"}'],
    [
      '{watch "$x" once dialog "Kitchen"}',
      1,
      26,
      '{watch "$x" once dialog "Kitchen"}',
    ],
  ])('rejects a missing passage in %s', (content, line, column, label) => {
    expect(inShop(content)).toEqual([
      `Passage "Shop", line ${line}, column ${column}: No passage named "Kitchen" in ${label}.`,
    ]);
  });

  it('suggests the passage a missing name is close to', () => {
    expect(inShop('{goto "hall"}[[Go->Hal]]{goto "Kitchen"}')).toEqual([
      'Passage "Shop", line 1, column 7: No passage named "hall" in {goto "hall"}. Did you mean "Hall"?',
      'Passage "Shop", line 1, column 20: No passage named "Hal" in [[Go->Hal]]. Did you mean "Hall"?',
      'Passage "Shop", line 1, column 31: No passage named "Kitchen" in {goto "Kitchen"}.',
    ]);
  });

  it('looks names up among all passages, also those it does not report on', () => {
    const diagnostics = validateMarkup(
      [
        { name: 'StoryInit', content: '[[Hall]]' },
        { name: 'Hall', content: '[[Nowhere]]' },
      ],
      {
        isKnownMacro: () => true,
        only: (passage) => passage.name === 'StoryInit',
      },
    );
    expect(diagnostics).toEqual([]);
  });
});
