import { describe, it, expect } from 'vitest';
import {
  parseStoryVariables,
  validatePassages,
  extractDefaults,
} from '../../src/story-variables';
import type { Passage } from '../../src/parser';

function makePassage(name: string, content: string): Passage {
  return { pid: 0, name, tags: [], metadata: {}, content };
}

function makePassages(...entries: [string, string][]): Map<string, Passage> {
  const map = new Map<string, Passage>();
  for (const [name, content] of entries) {
    map.set(name, makePassage(name, content));
  }
  return map;
}

describe('parseStoryVariables', () => {
  it('parses number declarations', () => {
    const schema = parseStoryVariables('$health = 100');
    expect(schema.get('health')).toEqual({
      name: 'health',
      type: 'number',
      default: 100,
    });
  });

  it('parses string declarations', () => {
    const schema = parseStoryVariables('$name = "Hero"');
    expect(schema.get('name')).toEqual({
      name: 'name',
      type: 'string',
      default: 'Hero',
    });
  });

  it('parses boolean declarations', () => {
    const schema = parseStoryVariables('$hasKey = false');
    expect(schema.get('hasKey')).toEqual({
      name: 'hasKey',
      type: 'boolean',
      default: false,
    });
  });

  it('parses array declarations', () => {
    const schema = parseStoryVariables('$inventory = []');
    const entry = schema.get('inventory')!;
    expect(entry.type).toBe('array');
    expect(entry.default).toEqual([]);
  });

  it('parses object declarations with field schema', () => {
    const schema = parseStoryVariables(
      '$player = { health: 100, name: "Hero", level: 1 }',
    );
    const entry = schema.get('player')!;
    expect(entry.type).toBe('object');
    expect(entry.fields!.get('health')!.type).toBe('number');
    expect(entry.fields!.get('name')!.type).toBe('string');
    expect(entry.fields!.get('level')!.type).toBe('number');
    expect(entry.default).toEqual({ health: 100, name: 'Hero', level: 1 });
  });

  it('parses nested object declarations', () => {
    const schema = parseStoryVariables(
      '$game = { player: { hp: 50 }, settings: { difficulty: 1 } }',
    );
    const entry = schema.get('game')!;
    expect(entry.type).toBe('object');
    const player = entry.fields!.get('player')!;
    expect(player.type).toBe('object');
    expect(player.fields!.get('hp')!.type).toBe('number');
  });

  it('parses multiple declarations', () => {
    const schema = parseStoryVariables(
      '$health = 100\n$name = "Hero"\n$hasKey = false',
    );
    expect(schema.size).toBe(3);
    expect(schema.get('health')!.type).toBe('number');
    expect(schema.get('name')!.type).toBe('string');
    expect(schema.get('hasKey')!.type).toBe('boolean');
  });

  it('skips blank lines', () => {
    const schema = parseStoryVariables('$a = 1\n\n$b = 2\n\n');
    expect(schema.size).toBe(2);
  });

  it('throws on invalid declaration syntax', () => {
    expect(() => parseStoryVariables('not a declaration')).toThrow(
      /Invalid declaration/,
    );
  });

  it('throws on invalid expression', () => {
    expect(() => parseStoryVariables('$x = {{{')).toThrow(/Failed to evaluate/);
  });
});

describe('extractDefaults', () => {
  it('extracts default values from schema', () => {
    const schema = parseStoryVariables('$health = 100\n$name = "Hero"');
    const defaults = extractDefaults(schema);
    expect(defaults).toEqual({ health: 100, name: 'Hero' });
  });
});

describe('validatePassages', () => {
  it('accepts valid variable references', () => {
    const schema = parseStoryVariables('$health = 100\n$name = "Hero"');
    const passages = makePassages(
      ['StoryVariables', '$health = 100\n$name = "Hero"'],
      ['Start', 'Your health is {$health} and name is {print $name}'],
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toEqual([]);
  });

  it.each([
    '{DO}$typo = 1;{/DO}',
    '{do}$typo = 1;{/DO}',
    '{Do}$typo = 1;{/do}',
  ])('scans a do body case-insensitively: %s', (content) => {
    const schema = parseStoryVariables('$gold = 1');
    const errors = validatePassages(makePassages(['Start', content]), schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/\$typo/);
  });

  it('catches undeclared variables in interpolated macro selectors', () => {
    const schema = parseStoryVariables('$gold = 1');
    for (const content of [
      '{.{$typo} button "Go"}{/button}',
      '{#{$typo} button "Go"}{/button}',
    ]) {
      const errors = validatePassages(makePassages(['Start', content]), schema);
      expect(errors, content).toHaveLength(1);
      expect(errors[0]).toMatch(/\$typo/);
    }
    expect(
      validatePassages(
        makePassages(['Start', '{.{$gold} button "Go"}{/button}']),
        schema,
      ),
    ).toEqual([]);
  });

  it('catches undeclared variables in bracket-link labels', () => {
    const schema = parseStoryVariables('$gold = 1');
    const errors = (content: string) =>
      validatePassages(makePassages(['Start', content], ['Next', '']), schema);
    expect(errors('[[Gold: {$typo}->Next]]')).toHaveLength(1);
    expect(errors('[[Next<-Gold: {$typo}]]')).toHaveLength(1);
    expect(errors('[[Gold: {$gold}->Next]]')).toEqual([]);
  });

  it('catches undeclared variable references', () => {
    const schema = parseStoryVariables('$health = 100');
    const passages = makePassages(
      ['StoryVariables', '$health = 100'],
      ['Start', 'Your score is {$score}'],
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Undeclared variable.*\$score/);
    expect(errors[0]).toMatch(/Passage "Start"/);
  });

  it('allows unknown object field references (classes may add them)', () => {
    const schema = parseStoryVariables(
      '$player = { health: 100, name: "Hero" }',
    );
    const passages = makePassages(
      ['StoryVariables', '$player = { health: 100, name: "Hero" }'],
      ['Start', 'Mana: {$player.mana}'],
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toEqual([]);
  });

  it('allows method/property access on arrays', () => {
    const schema = parseStoryVariables('$inventory = []\n$journal = []');
    const passages = makePassages(
      ['StoryVariables', '$inventory = []\n$journal = []'],
      [
        'Start',
        '{set _x = $inventory.find((i) => i)}{do}$journal.push(1){/do}{$inventory.length}',
      ],
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toEqual([]);
  });

  it('allows built-in properties and methods on primitives (#204)', () => {
    const decls =
      '$name = "hero"\n$n = 3.14159\n$flag = true\n$player = { name: "Hero" }';
    const schema = parseStoryVariables(decls);
    const passages = makePassages(
      ['StoryVariables', decls],
      [
        'Start',
        '{print $name.toUpperCase()}{$name.length}{print $n.toFixed(2)}' +
          '{print $flag.toString()}{$player.name.length}{$name.length.toFixed}',
      ],
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toEqual([]);
  });

  it('catches invalid access past a primitive built-in (#204)', () => {
    const schema = parseStoryVariables('$name = "hero"');
    const passages = makePassages(
      ['StoryVariables', '$name = "hero"'],
      ['Start', '{$name.length.bogus}{$name.bogus}'],
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(
      /Cannot access field "bogus" on \$name\.length \(type: number\)/,
    );
    expect(errors[1]).toMatch(
      /Cannot access field "bogus" on \$name \(type: string\)/,
    );
  });

  it('catches field access on non-object types', () => {
    const schema = parseStoryVariables('$health = 100');
    const passages = makePassages(
      ['StoryVariables', '$health = 100'],
      ['Start', 'Value: {$health.something}'],
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(
      /Cannot access field.*"something".*\$health.*number/,
    );
  });

  it('skips for-loop locals (@ syntax not matched by $ validator)', () => {
    const schema = parseStoryVariables('$inventory = []');
    const passages = makePassages(
      ['StoryVariables', '$inventory = []'],
      ['Start', '{for @item of $inventory}{@item}{/for}'],
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toEqual([]);
  });

  it('skips for-loop locals with index (@ syntax)', () => {
    const schema = parseStoryVariables('$inventory = []');
    const passages = makePassages(
      ['StoryVariables', '$inventory = []'],
      ['Start', '{for @i, @item of $inventory}{@i}: {@item}{/for}'],
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toEqual([]);
  });

  it('does not exempt $name for a same-named @name loop local (#275)', () => {
    const schema = parseStoryVariables('$x = ""');
    const errorsOf = (content: string) =>
      validatePassages(
        makePassages(['StoryVariables', '$x = ""'], ['Start', content]),
        schema,
      );
    expect(errorsOf('{for @item of [1]}{$item}{/for}')).toEqual([
      'Passage "Start": Undeclared variable: $item',
    ]);
    expect(errorsOf('{for @item of [1]}{/for}{$item}')).toHaveLength(1);
    expect(errorsOf('{for @item of [1]}{@item}{/for}')).toEqual([]);

    const typed = parseStoryVariables('$item = 1');
    const bad = validatePassages(
      makePassages(
        ['StoryVariables', '$item = 1'],
        ['Start', '{for @item of [1]}{$item.badField}{/for}'],
      ),
      typed,
    );
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatch(/Cannot access field.*badField/);
  });

  it('validates deeply nested object field access', () => {
    const schema = parseStoryVariables(
      '$game = { player: { stats: { hp: 50 } } }',
    );
    const passages = makePassages(
      ['StoryVariables', '$game = { player: { stats: { hp: 50 } } }'],
      ['Start', 'HP: {$game.player.stats.hp}'],
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toEqual([]);
  });

  it('allows unknown deep field access (classes may add them)', () => {
    const schema = parseStoryVariables(
      '$game = { player: { stats: { hp: 50 } } }',
    );
    const passages = makePassages(
      ['StoryVariables', '$game = { player: { stats: { hp: 50 } } }'],
      ['Start', 'MP: {$game.player.stats.mp}'],
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toEqual([]);
  });

  it('reports multiple errors across passages', () => {
    const schema = parseStoryVariables('$health = 100');
    const passages = makePassages(
      ['StoryVariables', '$health = 100'],
      ['Start', 'Score: {$score}'],
      ['Room', 'Gold: {print $gold}'],
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toHaveLength(2);
  });

  it('does not validate the StoryVariables passage itself', () => {
    const schema = parseStoryVariables('$health = 100');
    // StoryVariables content has $health which is declared — but even if
    // it had odd references, it should be skipped
    const passages = makePassages(
      ['StoryVariables', '$health = 100'],
      ['Start', 'HP: {$health}'],
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toEqual([]);
  });

  it('validates StoryInit passage like any other', () => {
    const schema = parseStoryVariables('$health = 100');
    const passages = makePassages(
      ['StoryVariables', '$health = 100'],
      ['Start', 'HP: {$health}'],
      ['StoryInit', '{set $score = 0}'],
    );
    const errors = validatePassages(passages, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(
      /Passage "StoryInit".*Undeclared variable.*\$score/,
    );
  });
});

describe('validatePassages: only real references (#178)', () => {
  const schema = parseStoryVariables('$health = 100');

  function errorsFor(content: string, storeVarMacros?: string[]): string[] {
    return validatePassages(
      makePassages(['StoryVariables', '$health = 100'], ['A', content]),
      schema,
      storeVarMacros,
    );
  }

  it.each([
    ['double-quoted string', '{print "Price: $cost"}'],
    ['single-quoted string', "{print 'Price: $cost'}"],
    ['escaped quote inside string', '{print "say \\"$cost\\" now"}'],
    ['template literal text', '{print `Price: $cost`}'],
    ['link label string', '{link "Pay $cost" "Shop"}{/link}'],
    ['string in set', '{set _label = "$cost each"}'],
    ['literal prose', 'It costs $cost, or $5.'],
    ['prose in HTML', '<span title="$cost">Price: $cost</span>'],
    ['link markup', '[[Pay $cost->Shop]]'],
    ['escaped braces', '\\{$cost\\}'],
    ['escaped brace in an attribute', '<b title="\\{$cost}">x</b>'],
    ['code in an event handler', '<b onclick="if (a) {return $cost}">x</b>'],
    ['code in a pattern', '<input pattern="{if $cost}">'],
    [
      'line comment in do body',
      '{do}\n// uses $cost later\n$health = 1\n{/do}',
    ],
    ['block comment in do body', '{do}/* $cost */ $health = 1{/do}'],
    ['block comment in expression', '{print $health /* $cost */}'],
    ['string inside do body', '{do}$health = "$cost".length{/do}'],
    // The code is lexed as the expression engine lexes it
    ['string after a regex with a quote', '{print /"/.test("$cost")}'],
    ['string after a regex with a backtick', '{print /`/.test("$cost")}'],
    ['string after a regex class with a slash', "{print /[/']/.test('$cost')}"],
    ['property named like a variable', '{print $health.$cost}'],
    ['object key named like a variable', '{print { $cost: 1 }.x}'],
  ])('ignores $cost in %s', (_label, content) => {
    expect(errorsFor(content)).toEqual([]);
  });

  it.each([
    ['variable display', '{$cost}'],
    ['variable display with selector', '{.big $cost}'],
    ['expression display', '{$cost + 1}'],
    ['print argument', '{print $cost}'],
    ['print after a string', '{print "Price: " + $cost}'],
    ['set target', '{set $cost = 5}'],
    ['if condition', '{if $cost > 1}x{/if}'],
    ['template interpolation', '{print `Price: ${$cost}`}'],
    ['nested template interpolation', '{print `a ${`b ${$cost}`}`}'],
    ['string interpolation block', '{link "Pay {$cost}" "Shop"}{/link}'],
    ['HTML attribute interpolation', '<img src="{$cost}.png">'],
    ['event handler reference', '<b onclick="go({$cost})">x</b>'],
    ['HTML attribute macro', '<b class="{if $cost > 1}a{/if}">x</b>'],
    ['HTML attribute macro body', '<b class="{if true}{$cost}{/if}">x</b>'],
    ['HTML attribute expression opened by !', '<b title="{!$cost}">x</b>'],
    ['expression opened by (', '{($cost + 1)}'],
    ['macro in a label string', '{button "{if $cost}a{/if}"}{/button}'],
    ['do body', '{do}$cost = 1{/do}'],
    ['do body after a comment', '{do}// note\n$cost = 1{/do}'],
    ['do body with braces', '{do}if ($health) { $cost = {a: 1} }{/do}'],
    ['quoted input macro variable', '{textbox "$cost" "Enter"}'],
    ['unquoted input macro variable', '{numberbox $cost}'],
    ['widget invocation argument', '{Card $cost}'],
    ['argument after a regex with a quote', '{print /"/.test($cost)}'],
    ['argument after a regex with a backtick', '{print /`/.test($cost)}'],
    ['template after a regex', '{print /\\//.test(`${$cost}`)}'],
  ])('reports undeclared $cost in %s', (_label, content) => {
    const errors = errorsFor(content);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Passage "A": Undeclared variable: \$cost/);
  });

  it('reports a real reference next to an ignored string', () => {
    const errors = errorsFor('{print "$price: " + $cost}');
    expect(errors).toEqual(['Passage "A": Undeclared variable: $cost']);
  });

  it('validates field access on real references only', () => {
    expect(errorsFor('{print "$health.foo"}')).toEqual([]);
    expect(errorsFor('{print $health.foo}')).toHaveLength(1);
  });

  it('uses the given input macro names for quoted variables', () => {
    expect(errorsFor('{picker "$cost"}')).toEqual([]);
    expect(errorsFor('{picker "$cost"}', ['Picker'])).toHaveLength(1);
  });
});

describe('validatePassages: code in watch strings (#257)', () => {
  const schema = parseStoryVariables('$x = 0');

  function errorsFor(content: string): string[] {
    return validatePassages(
      makePassages(['StoryVariables', '$x = 0'], ['A', content]),
      schema,
    );
  }

  it('rejects undeclared names in the condition and the run action', () => {
    expect(errorsFor('{watch "$notdeclared > 0"}')).toHaveLength(1);
    expect(errorsFor('{watch "$x > 0" run "$alsoMissing = 1"}')).toEqual([
      expect.stringContaining('alsoMissing'),
    ]);
  });

  it('accepts declared names', () => {
    expect(errorsFor('{watch "$x > 0" run "$x = 1"}')).toEqual([]);
  });

  it('does not read literal strings as markup (#272)', () => {
    for (const content of [
      '{textbox $x "{$price}"}',
      '{checkbox $x "{$price}"}',
      '{watch "$x" goto "{$price}"}',
      '{do}_s = "{$price}"{/do}{_s}',
      '{print "{$price}"}',
    ]) {
      expect(errorsFor(content), content).toEqual([]);
    }
  });

  it('still reads markup strings and widget arguments (#272)', () => {
    expect(errorsFor('{button "{$price}"}{/button}')).toHaveLength(1);
    expect(errorsFor('{link "{$price}" "A"}{/link}')).toHaveLength(1);
    expect(errorsFor('{textbox "$missing"}')).toHaveLength(1);
    expect(errorsFor('{print $missing}')).toHaveLength(1);
  });

  it('keeps literal $name text in other strings', () => {
    expect(errorsFor('{watch "$x > 0" name "$cost" goto "Hall"}')).toEqual([]);
    expect(errorsFor('{button "Pay $cost"}{/button}')).toEqual([]);
  });
});

describe('validatePassages: SaveTitle is JavaScript (#251)', () => {
  it('does not read SaveTitle as markup', () => {
    expect(
      validatePassages(
        makePassages(
          ['StoryVariables', '$x = 0'],
          ['SaveTitle', 'return "$notdeclared {$nope}";'],
        ),
        parseStoryVariables('$x = 0'),
      ),
    ).toEqual([]);
  });
});
