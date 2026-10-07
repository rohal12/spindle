/**
 * The story-start check of the code in passages (code-check.ts), run as
 * part of the markup check (markup/validate.ts).
 */
import { describe, it, expect } from 'vitest';
import { formatDiagnostic, validateMarkup } from '../../src/markup/validate';
import { validateStoryMarkup } from '../../src/tooling';
import { holdsCode, parameterLookup } from '../../src/code-check';
import {
  getMacro,
  getMacroRegistry,
  isSubMacro,
  type MacroMetadata,
  type StringHolds,
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
  const known = new Set(macros.map((m) => m.name.toLowerCase()));
  const list = Object.entries(passages).map(([name, content]) => ({
    name,
    content,
  }));
  return validateMarkup(list, {
    isKnownMacro: (name) =>
      !!getMacro(name) || isSubMacro(name) || known.has(name),
    macroNames: known,
    parametersOf: parameterLookup(macros),
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
        '{link "Don\'t go"}x{/link}{button Don\'t panic}x{/button}' +
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

describe('bracket-link labels', () => {
  const check = (content: string) =>
    validateStoryMarkup(
      [
        { name: 'Start', content },
        { name: 'Next', content: '' },
      ],
      getMacroRegistry(),
    ).map(formatDiagnostic);

  it('checks the markup a label evaluates, as {link} does', () => {
    expect(check('[[Gold: {print $gold +}->Next]]')).toHaveLength(1);
    expect(check('{link "Gold: {print $gold +}" "Next"}{/link}')).toHaveLength(
      1,
    );
    expect(check('[[{doesnotexist}->Next]]')).not.toEqual([]);
    expect(check('[[Gold: {$gold}->Next]]')).toEqual([]);
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
          '{link "Go" $room}x{/link}{link \'Go\' "Ha" + "ll"}x{/link}' +
          '{dialog "Map"}Hall{/dialog}{dialog "Map"}{$room}{/dialog}' +
          '{watch "$x" goto "Hall" dialog "Hall"}',
      ),
    ).toEqual([]);
  });

  it.each([
    [
      '{link "Go" Kitchen}x{/link}',
      'column 12: Unquoted passage name in {link "Go" Kitchen}: write "Kitchen" (a passage name is a quoted string or an expression)',
    ],
    [
      '{link "Go" $room +}x{/link}',
      'column 19: Unexpected end of code in {link "Go" $room +} (a passage name is a quoted string or an expression)',
    ],
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
    ['[[Kitchen->Kitchen]]', 1, 12, '[[Kitchen->Kitchen]]'],
    ['[[Kitchen|Kitchen]]', 1, 11, '[[Kitchen|Kitchen]]'],
    ['[[Kitchen<-Kitchen]]', 1, 3, '[[Kitchen<-Kitchen]]'],
    ['[[.big#k Kitchen]]', 1, 10, '[[.big#k Kitchen]]'],
    ['{link "Cook" "Kitchen"}x{/link}', 1, 14, '{link "Cook" "Kitchen"}'],
    ['{dialog "Cook"}Kitchen{/dialog}', 1, 16, '{dialog "Cook"}'],
    ["{dialog 'Cook'}\n 'Kitchen' \n{/dialog}", 2, 2, "{dialog 'Cook'}"],
    ['{watch "$x" goto "Kitchen"}', 1, 18, '{watch "$x" goto "Kitchen"}'],
    [
      '{watch "$x" once dialog "Kitchen"}',
      1,
      25,
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

describe('the story-start check of quoted arguments', () => {
  it.each([
    [
      '{link Go north}x{/link}',
      'column 7: The text must be a quoted string ("…" or \'…\'), not Go in {link Go north}',
    ],
    [
      '{listbox $x}{option "a"}{option b}{/listbox}',
      'column 33: The value must be a quoted string ("…" or \'…\'), not b in {option b}',
    ],
    [
      '{watch $x > 0 once}',
      'column 8: The condition must be a quoted string ("…" or \'…\'), not $x in {watch $x > 0 once}',
    ],
  ])('rejects %s', (content, message) => {
    expect(errors(content)).toEqual([`Passage "Shop", line 1, ${message}`]);
  });

  it('accepts an optional string left out at the end', () => {
    expect(errors('{meter $hp 100}{meter $hp 100 "HP"}')).toEqual([]);
  });
});

describe('the story-start check: what a string holds (#264)', () => {
  /** A custom macro {travel} whose quoted `to` holds `holds`. */
  const travel = (holds?: StringHolds, interpolate?: boolean) => [
    {
      name: 'travel',
      block: false,
      subMacros: [],
      source: 'user' as const,
      interpolate,
      parameters: [{ name: 'to', type: 'string' as const, holds }],
    },
  ];

  it('looks up a passage name a custom macro declares', () => {
    const extra = travel('passage');
    expect(storyErrors({ Start: '{travel "Hall"}', Hall: 'x' }, extra)).toEqual(
      [],
    );
    expect(storyErrors({ Start: '{travel "Hal"}', Hall: 'x' }, extra)).toEqual([
      'Passage "Start", line 1, column 9: No passage named "Hal" in {travel "Hal"}. Did you mean "Hall"?',
    ]);
  });

  it.each([
    ['expression', '{travel "$a +"}', 'line 1, column 14'],
    ['statements', '{travel "if ("}', 'line 1, column 14'],
  ] as const)('checks the code a custom macro declares: %s', (holds, m, at) => {
    expect(storyErrors({ Start: m }, travel(holds))).toEqual([
      expect.stringContaining(`Passage "Start", ${at}: `),
    ]);
  });

  it('checks markup by default only in macros with interpolate', () => {
    const markup = '{travel "{literal}"}';
    expect(storyErrors({ Start: markup }, travel())).toEqual([]);
    expect(storyErrors({ Start: markup }, travel('text', true))).toEqual([]);
    for (const extra of [travel(undefined, true), travel('markup')]) {
      expect(storyErrors({ Start: markup }, extra)).toEqual([
        expect.stringContaining('In the to of {travel}: Unknown macro'),
      ]);
    }
  });
});

describe('parameterLookup (#267)', () => {
  const lookup = parameterLookup([
    {
      name: 'Shout',
      interpolate: true,
      parameters: [
        { name: 'what', type: 'text' },
        { name: 'quietly', type: 'flag' },
      ],
    },
    { name: 'plain' },
  ]);

  it('finds macros in any case, with what their strings hold', () => {
    expect(lookup('SHOUT')).toEqual([
      { name: 'what', type: 'text', holds: 'markup' },
      { name: 'quietly', type: 'flag' },
    ]);
    expect(lookup('shout')).toBe(lookup('Shout'));
    expect(lookup('plain')).toBeUndefined();
    expect(lookup('nope')).toBeUndefined();
  });

  it('gives the parameters of the built-in sub-macros', () => {
    expect(lookup('Option')).toEqual([
      { name: 'value', type: 'string', holds: 'text', required: true },
    ]);
  });
});

describe('holdsCode (#266)', () => {
  it('is true only for parameters (options too) that hold code', () => {
    const watch = getMacroRegistry().find((m) => m.name === 'watch')!;
    expect(holdsCode(watch.parameters!)).toBe(true);
    expect(holdsCode([{ name: 'a', type: 'expression' }])).toBe(false);
    expect(
      holdsCode([
        {
          name: 'o',
          type: 'options',
          parameters: [{ name: 'r', type: 'string', holds: 'statements' }],
        },
      ]),
    ).toBe(true);
    for (const m of getMacroRegistry()) {
      if (m.name !== 'watch') expect(holdsCode(m.parameters ?? [])).toBe(false);
    }
  });
});

describe('the story-start check: reported bugs', () => {
  it('does not read SaveTitle as markup (#251)', () => {
    expect(
      storyErrors({
        Start: 'Hello.',
        SaveTitle: 'const {gold} = variables;\nreturn "[[slot]]";',
      }),
    ).toEqual([]);
  });

  it.each([
    ['link', '{link "Go" "\\u0048all"}{/link}'],
    ['goto', '{goto "\\x48all"}'],
    ['goto with u{}', '{goto "\\u{48}all"}'],
    ['goto with a line continuation', '{goto "Ha\\\nll"}'],
  ])('decodes JavaScript escapes in a passage name: %s (#252)', (_, markup) => {
    expect(storyErrors({ Start: markup, Hall: 'Arrived.' })).toEqual([]);
    expect(storyErrors({ Start: markup, '\\u0048all': 'x' })).toHaveLength(1);
  });

  it('names the passage a legacy octal escape gives (#262)', () => {
    expect(
      storyErrors({ Start: '{goto "\\1"}', '\u0001': 'Arrived.' }),
    ).toEqual([]);
    expect(storyErrors({ Start: '{goto "\\1"}', '1': 'x' })).toHaveLength(1);
  });

  it('does not throw for unknown prototype member macros (#253)', () => {
    expect(storyErrors({ Start: '{constructor x}' })).toEqual([
      expect.stringContaining('Unknown macro {constructor}'),
    ]);
    expect(storyErrors({ Start: '{toString x}{__proto__ y}' })).toHaveLength(2);
  });

  it('validates a registered constructor macro without parameters (#253)', () => {
    const extra: MacroMetadata[] = [
      {
        name: 'constructor',
        block: false,
        subMacros: [],
        source: 'user',
      },
    ];
    expect(storyErrors({ Start: '{constructor x}' }, extra)).toEqual([]);
  });

  it('keeps literal option and watcher names out of markup checks (#254)', () => {
    expect(
      storyErrors({
        Start:
          '{listbox $c}{option "{literal}"}{/listbox}{watch "1" name "{literal}"}{unwatch "{literal}"}',
      }),
    ).toEqual([]);
    expect(storyErrors({ Start: '{button "{literal}"}{/button}' })).toEqual([
      expect.stringContaining('Unknown macro {literal}'),
    ]);
  });

  it.each([
    ['a {watch} goto', '{watch "1" goto "Hall {east}"}'],
    ['a {watch} dialog', '{watch "1" dialog "Hall {east}"}'],
    ['a {checkbox} label', '{checkbox $a "{literal}"}'],
    ['a {radiobutton} label', '{radiobutton $b "a" "{literal}"}'],
    ['a {radiobutton} value', '{radiobutton $b "{literal}"}'],
    ['a {textbox} placeholder', '{textbox $c "{literal}"}'],
    ['a {numberbox} placeholder', '{numberbox $c "{literal}"}'],
    ['a {textarea} placeholder', '{textarea $c "{literal}"}'],
  ])('keeps %s out of markup checks (#259)', (_, markup) => {
    expect(storyErrors({ Start: markup, 'Hall {east}': 'x' })).toEqual([]);
  });

  it.each([
    ['{button "{literal}"}{/button}', 'In the label of {button}'],
    ['{dialog "{literal}"}Start{/dialog}', 'In the label of {dialog}'],
    ['{link "{literal}" "Start"}{/link}', 'In the text of {link}'],
    ['{meter $a 10 "{literal}"}', 'In the label of {meter}'],
  ])('checks the markup in %s (#259)', (markup, where) => {
    expect(storyErrors({ Start: markup })).toEqual([
      expect.stringContaining(`${where}: Unknown macro {literal}`),
    ]);
  });

  it.each([
    ['unquoted goto', '{watch "1" goto Hall}', 'goto'],
    ['unquoted run', '{watch "1" run doStuff}', 'run'],
    ['numeric goto', '{watch "1" goto 123}', 'goto'],
    ['missing name', '{watch "1" name}', 'name'],
  ])(
    'rejects a string option that is not quoted: %s (#256)',
    (_, m, option) => {
      expect(storyErrors({ Start: m })).toEqual([
        expect.stringContaining(`The ${option} must be a quoted string`),
      ]);
    },
  );
});
