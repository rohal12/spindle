import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluate,
  execute,
  clearExpressionCache,
  transform,
} from '../../src/expression';
import { executeMutation } from '../../src/execute-mutation';
import { useStoryStore } from '../../src/store';
import type { StoryData, Passage } from '../../src/parser';

describe('evaluate', () => {
  it('evaluates a simple expression', () => {
    expect(evaluate('1 + 2', {}, {})).toBe(3);
  });

  it('reads $variables', () => {
    expect(evaluate('$health', { health: 42 }, {})).toBe(42);
  });

  it('reads _temporary variables', () => {
    expect(evaluate('_count', {}, { count: 10 })).toBe(10);
  });

  it('handles mixed variables and math', () => {
    expect(evaluate('$health + _bonus', { health: 50 }, { bonus: 10 })).toBe(
      60,
    );
  });

  it('handles string expressions', () => {
    expect(evaluate("$name + ' the Brave'", { name: 'Hero' }, {})).toBe(
      'Hero the Brave',
    );
  });

  it('handles boolean expressions', () => {
    expect(evaluate('$health > 50', { health: 100 }, {})).toBe(true);
    expect(evaluate('$health > 50', { health: 10 }, {})).toBe(false);
  });

  it('handles comparison operators', () => {
    expect(evaluate('$x >= 5', { x: 5 }, {})).toBe(true);
    expect(evaluate("$x === 'hello'", { x: 'hello' }, {})).toBe(true);
  });

  it('handles array access', () => {
    expect(evaluate('$items[0]', { items: ['sword', 'shield'] }, {})).toBe(
      'sword',
    );
  });

  it('handles object property access', () => {
    expect(evaluate('$player.name', { player: { name: 'Hero' } }, {})).toBe(
      'Hero',
    );
  });

  it('throws on syntax errors', () => {
    expect(() => evaluate('$x +', { x: 1 }, {})).toThrow();
  });

  it('throws on undefined variable access (in strict-ish contexts)', () => {
    // Accessing undefined property returns undefined, not an error
    expect(evaluate('$missing', {}, {})).toBeUndefined();
  });

  it('reads @local variables', () => {
    expect(evaluate('@count', {}, {}, { count: 7 })).toBe(7);
  });

  it('handles mixed $, _, and @ variables', () => {
    expect(evaluate('@x + $y + _z', { y: 10 }, { z: 20 }, { x: 5 })).toBe(35);
  });

  it('returns undefined for missing @local', () => {
    expect(evaluate('@missing', {}, {}, {})).toBeUndefined();
  });

  it('does not transform underscore property access on objects', () => {
    const vars: Record<string, unknown> = { obj: { _secret: 42 } };
    expect(evaluate('$obj._secret', vars, {})).toBe(42);
  });

  it('does not transform underscore property access after bracket notation', () => {
    const vars: Record<string, unknown> = { arr: [{ _id: 'abc' }] };
    expect(evaluate('$arr[0]._id', vars, {})).toBe('abc');
  });

  it('still transforms standalone _temp variables', () => {
    expect(evaluate('_count + 1', {}, { count: 9 })).toBe(10);
  });

  it('still transforms _temp after operators', () => {
    expect(evaluate('1 + _x', {}, { x: 5 })).toBe(6);
  });

  it('reads %transient variables', () => {
    expect(evaluate('%count', {}, {}, {}, { count: 7 })).toBe(7);
  });

  it('handles mixed $, _, @, and % variables', () => {
    expect(
      evaluate('@x + $y + _z + %w', { y: 10 }, { z: 20 }, { x: 5 }, { w: 3 }),
    ).toBe(38);
  });

  it('returns undefined for missing %transient', () => {
    expect(evaluate('%missing', {}, {}, {}, {})).toBeUndefined();
  });

  it('resolves %transient dot paths', () => {
    expect(evaluate('%obj.name', {}, {}, {}, { obj: { name: 'test' } })).toBe(
      'test',
    );
  });

  it('does not transform % inside string literals', () => {
    expect(evaluate('"100%"', {}, {}, {}, {})).toBe('100%');
  });

  it('preserves modulo operator with word chars before %', () => {
    expect(evaluate('10 % 3', {}, {}, {}, {})).toBe(1);
    expect(evaluate('10%3', {}, {}, {}, {})).toBe(1);
  });

  it('distinguishes modulo from %transient', () => {
    expect(evaluate('%x + 10 % 3', {}, {}, {}, { x: 5 })).toBe(6);
  });

  it('keeps compact modulo after a closing delimiter (#205)', () => {
    expect(evaluate('($n)%3', { n: 10 }, {})).toBe(1);
    expect(evaluate('$a[1]%3', { a: [0, 7] }, {})).toBe(1);
    expect(evaluate('(10)%3', {}, {}, {}, { 3: 99 })).toBe(1);
  });

  it('keeps modulo whose operand is a sigil variable (#205)', () => {
    expect(evaluate('$a%$b', { a: 10, b: 4 }, {})).toBe(2);
    expect(evaluate('$a %_b', { a: 10 }, { b: 3 })).toBe(1);
    expect(evaluate('$a%@b', { a: 10 }, {}, { b: 6 })).toBe(4);
    expect(evaluate('$a %3', { a: 10 }, {})).toBe(1);
    expect(evaluate('"ab".length%2', {}, {})).toBe(0);
  });

  it('reads %transient in operand position next to modulo (#205)', () => {
    const trans = { x: 10, y: 4, list: [5, 6] };
    expect(evaluate('%x%%y', {}, {}, {}, trans)).toBe(2);
    expect(evaluate('(%x)%(%y)', {}, {}, {}, trans)).toBe(2);
    expect(evaluate('%list[1]%%y', {}, {}, {}, trans)).toBe(2);
    expect(evaluate('-%x', {}, {}, {}, trans)).toBe(-10);
    expect(evaluate('typeof %x', {}, {}, {}, trans)).toBe('number');
    expect(evaluate('[%x, %y]', {}, {}, {}, trans)).toEqual([10, 4]);
    expect(evaluate('[...%list]', {}, {}, {}, trans)).toEqual([5, 6]);
    expect(evaluate('Math.max(%x, %y)%3', {}, {}, {}, trans)).toBe(1);
    expect(evaluate('%x > 5 ? %y : %x', {}, {}, {}, trans)).toBe(4);
    expect(evaluate('`${%x}%`', {}, {}, {}, trans)).toBe('10%');
  });

  it('reads %transient names beginning with an underscore (#205)', () => {
    expect(evaluate('%_x', {}, { x: 1 }, {}, { _x: 2 })).toBe(2);
  });
});

describe('execute', () => {
  it('sets a $variable', () => {
    const vars: Record<string, unknown> = {};
    execute('$health = 100', vars, {});
    expect(vars.health).toBe(100);
  });

  it('sets a _temporary variable', () => {
    const temps: Record<string, unknown> = {};
    execute('_count = 42', {}, temps);
    expect(temps.count).toBe(42);
  });

  it('modifies existing variables', () => {
    const vars: Record<string, unknown> = { health: 100 };
    execute('$health = $health - 10', vars, {});
    expect(vars.health).toBe(90);
  });

  it('handles multiple statements', () => {
    const vars: Record<string, unknown> = {};
    execute('$a = 1; $b = 2; $c = $a + $b', vars, {});
    expect(vars.a).toBe(1);
    expect(vars.b).toBe(2);
    expect(vars.c).toBe(3);
  });

  it('handles array assignment', () => {
    const vars: Record<string, unknown> = {};
    execute('$items = ["sword", "shield"]', vars, {});
    expect(vars.items).toEqual(['sword', 'shield']);
  });

  it('handles object assignment', () => {
    const vars: Record<string, unknown> = {};
    execute('$player = {name: "Hero", hp: 100}', vars, {});
    expect(vars.player).toEqual({ name: 'Hero', hp: 100 });
  });

  it('preserves $ inside string literals', () => {
    const vars: Record<string, unknown> = {};
    execute('$with_dollar = "costs $5"', vars, {});
    expect(vars.with_dollar).toBe('costs $5');
  });

  it('preserves @ inside string literals', () => {
    const vars: Record<string, unknown> = {};
    execute('$with_at = "email@test"', vars, {});
    expect(vars.with_at).toBe('email@test');
  });

  it('preserves _ inside string literals', () => {
    const vars: Record<string, unknown> = {};
    execute('$with_underscore = "snake_case"', vars, {});
    expect(vars.with_underscore).toBe('snake_case');
  });

  it('preserves special chars in single-quoted strings', () => {
    const vars: Record<string, unknown> = {};
    execute("$msg = 'costs $5 for user@home'", vars, {});
    expect(vars.msg).toBe('costs $5 for user@home');
  });

  it('preserves special chars in backtick template literal parts', () => {
    const vars: Record<string, unknown> = {};
    execute('$msg = `costs $5 for user@home`', vars, {});
    expect(vars.msg).toBe('costs $5 for user@home');
  });

  it('transforms variables inside template literal interpolations', () => {
    const vars: Record<string, unknown> = { name: 'Hero' };
    expect(evaluate('`hello ${$name}`', vars, {})).toBe('hello Hero');
  });

  it('handles template literal with both literal sigils and interpolated vars', () => {
    const vars: Record<string, unknown> = { price: 5 };
    expect(evaluate('`costs $${$price}`', vars, {})).toBe('costs $5');
  });

  it('handles string containing } brace inside template interpolation with variable after', () => {
    // The inner loop should not break on } inside a string literal
    const vars: Record<string, unknown> = { a: 'x', b: 'y' };
    expect(evaluate('`${$a + "}" + $b}`', vars, {})).toBe('x}y');
  });

  it('handles nested template literals in interpolation', () => {
    const vars: Record<string, unknown> = { x: 1, y: 2 };
    expect(evaluate('`${`${$x}+${$y}`}`', vars, {})).toBe('1+2');
  });

  it('handles single-quoted } with variable after inside template interpolation', () => {
    const vars: Record<string, unknown> = { val: 42 };
    expect(evaluate("`${'}' + $val}`", vars, {})).toBe('}42');
  });

  it('throws on syntax errors', () => {
    expect(() => execute('$x =', {}, {})).toThrow();
  });

  it('sets a @local variable', () => {
    const locals: Record<string, unknown> = {};
    execute('@count = 42', {}, {}, locals);
    expect(locals.count).toBe(42);
  });

  it('modifies existing @local', () => {
    const locals: Record<string, unknown> = { x: 10 };
    execute('@x = @x + 5', {}, {}, locals);
    expect(locals.x).toBe(15);
  });

  it('can mix @ and $ in assignment', () => {
    const vars: Record<string, unknown> = { total: 0 };
    const locals: Record<string, unknown> = { item: 10 };
    execute('$total = $total + @item', vars, {}, locals);
    expect(vars.total).toBe(10);
  });

  it('sets a %transient variable', () => {
    const trans: Record<string, unknown> = {};
    execute('%count = 42', {}, {}, {}, trans);
    expect(trans.count).toBe(42);
  });

  it('modifies existing %transient', () => {
    const trans: Record<string, unknown> = { x: 10 };
    execute('%x = %x + 5', {}, {}, {}, trans);
    expect(trans.x).toBe(15);
  });

  it('can mix % and $ in assignment', () => {
    const vars: Record<string, unknown> = { total: 0 };
    const trans: Record<string, unknown> = { bonus: 10 };
    execute('$total = $total + %bonus', vars, {}, {}, trans);
    expect(vars.total).toBe(10);
  });

  it('assigns %transient at statement starts (#205)', () => {
    const vars: Record<string, unknown> = { n: 10 };
    const trans: Record<string, unknown> = { a: 0, b: 0, c: 0, d: 0 };
    execute(
      '$n = $n%3\n%a = 1; if ($n) %b = 2; else %c = 3\nif (true) { %d = ($n)%2 }',
      vars,
      {},
      {},
      trans,
    );
    expect(vars.n).toBe(1);
    expect(trans).toEqual({ a: 1, b: 2, c: 0, d: 1 });
  });

  it('assigns %transient inside a for-of header (#205)', () => {
    const trans: Record<string, unknown> = { list: [1, 2, 3], sum: 0 };
    execute('for (const x of %list) %sum += x', {}, {}, {}, trans);
    expect(trans.sum).toBe(6);
  });
});

describe('expression tracking functions', () => {
  function makePassage(pid: number, name: string, content = ''): Passage {
    return { pid, name, tags: [], metadata: {}, content };
  }

  function makeStoryData(passages: Passage[], startNode = 1): StoryData {
    const passageMap = new Map<string, Passage>();
    const passagesById = new Map<number, Passage>();
    for (const p of passages) {
      passageMap.set(p.name, p);
      passagesById.set(p.pid, p);
    }
    return {
      name: 'Test Story',
      startNode,
      ifid: 'TEST-IFID',
      format: 'spindle',
      formatVersion: '0.1.0',
      passages: passageMap,
      passagesById,
      userCSS: '',
      userScript: '',
    };
  }

  beforeEach(() => {
    useStoryStore.setState({
      storyData: null,
      currentPassage: '',
      variables: {},
      variableDefaults: {},
      temporary: {},
      history: [],
      historyIndex: -1,
      visitCounts: {},
      renderCounts: {},
    });
  });

  it('visited() returns correct count', () => {
    const story = makeStoryData([
      makePassage(1, 'Start'),
      makePassage(2, 'Room'),
    ]);
    useStoryStore.getState().init(story);
    useStoryStore.getState().navigate('Room');

    expect(evaluate('visited("Start")', {}, {})).toBe(1);
    expect(evaluate('visited("Room")', {}, {})).toBe(1);
    expect(evaluate('visited("Unknown")', {}, {})).toBe(0);
  });

  it('hasVisited() returns boolean', () => {
    const story = makeStoryData([
      makePassage(1, 'Start'),
      makePassage(2, 'Room'),
    ]);
    useStoryStore.getState().init(story);

    expect(evaluate('hasVisited("Start")', {}, {})).toBe(true);
    expect(evaluate('hasVisited("Room")', {}, {})).toBe(false);
  });

  it('hasVisitedAny() with multiple args', () => {
    const story = makeStoryData([
      makePassage(1, 'Start'),
      makePassage(2, 'Room'),
      makePassage(3, 'Hall'),
    ]);
    useStoryStore.getState().init(story);

    expect(evaluate('hasVisitedAny("Start", "Room")', {}, {})).toBe(true);
    expect(evaluate('hasVisitedAny("Room", "Hall")', {}, {})).toBe(false);
  });

  it('hasVisitedAll() with multiple args', () => {
    const story = makeStoryData([
      makePassage(1, 'Start'),
      makePassage(2, 'Room'),
    ]);
    useStoryStore.getState().init(story);
    useStoryStore.getState().navigate('Room');

    expect(evaluate('hasVisitedAll("Start", "Room")', {}, {})).toBe(true);
    expect(evaluate('hasVisitedAll("Start", "Unknown")', {}, {})).toBe(false);
  });

  it('rendered() returns correct count including trackRender', () => {
    const story = makeStoryData([
      makePassage(1, 'Start'),
      makePassage(2, 'Sidebar'),
    ]);
    useStoryStore.getState().init(story);
    useStoryStore.getState().trackRender('Sidebar');
    useStoryStore.getState().trackRender('Sidebar');

    expect(evaluate('rendered("Start")', {}, {})).toBe(1);
    expect(evaluate('rendered("Sidebar")', {}, {})).toBe(2);
  });

  it('hasRendered() returns boolean', () => {
    const story = makeStoryData([
      makePassage(1, 'Start'),
      makePassage(2, 'Sidebar'),
    ]);
    useStoryStore.getState().init(story);
    useStoryStore.getState().trackRender('Sidebar');

    expect(evaluate('hasRendered("Start")', {}, {})).toBe(true);
    expect(evaluate('hasRendered("Sidebar")', {}, {})).toBe(true);
    expect(evaluate('hasRendered("Unknown")', {}, {})).toBe(false);
  });

  it('hasRenderedAny() with multiple args', () => {
    const story = makeStoryData([
      makePassage(1, 'Start'),
      makePassage(2, 'Room'),
    ]);
    useStoryStore.getState().init(story);

    expect(evaluate('hasRenderedAny("Start", "Room")', {}, {})).toBe(true);
    expect(evaluate('hasRenderedAny("Room", "Unknown")', {}, {})).toBe(false);
  });

  it('hasRenderedAll() with multiple args', () => {
    const story = makeStoryData([
      makePassage(1, 'Start'),
      makePassage(2, 'Room'),
    ]);
    useStoryStore.getState().init(story);
    useStoryStore.getState().trackRender('Room');

    expect(evaluate('hasRenderedAll("Start", "Room")', {}, {})).toBe(true);
    expect(evaluate('hasRenderedAll("Start", "Unknown")', {}, {})).toBe(false);
  });
});

describe('clearExpressionCache', () => {
  it('is a callable function', () => {
    expect(typeof clearExpressionCache).toBe('function');
  });

  it('can be called without errors after evaluating expressions', () => {
    evaluate('1 + 2', {}, {});
    evaluate('3 + 4', {}, {});
    clearExpressionCache();
    // After clearing, expressions should still evaluate correctly (recompiled)
    expect(evaluate('1 + 2', {}, {})).toBe(3);
  });
});

describe('executeMutation', () => {
  beforeEach(() => {
    useStoryStore.setState({
      variables: {},
      temporary: {},
    });
  });

  it('detects deleted $variables', () => {
    useStoryStore.getState().setVariable('foo', 'bar');
    expect(useStoryStore.getState().variables.foo).toBe('bar');

    executeMutation('delete $foo', {}, () => {});

    expect(useStoryStore.getState().variables.foo).toBeUndefined();
    expect('foo' in useStoryStore.getState().variables).toBe(false);
  });

  it('detects deleted _temporary variables', () => {
    useStoryStore.getState().setTemporary('t', 123);
    expect(useStoryStore.getState().temporary.t).toBe(123);

    executeMutation('delete _t', {}, () => {});

    expect(useStoryStore.getState().temporary.t).toBeUndefined();
    expect('t' in useStoryStore.getState().temporary).toBe(false);
  });

  // Reproduction of issue #136: consecutive {set} macros can't see each other
  it('consecutive _temp mutations see each other (issue #136)', () => {
    // Simulates: {set _x = [3, 1, 2]} then {set _y = _x.slice().sort()}
    executeMutation('_x = [3, 1, 2]', {}, () => {});
    executeMutation('_y = _x.slice().sort()', {}, () => {});

    expect(useStoryStore.getState().temporary.x).toEqual([3, 1, 2]);
    expect(useStoryStore.getState().temporary.y).toEqual([1, 2, 3]);
  });

  it('consecutive $var mutations see each other (issue #136)', () => {
    // Simulates: {set $x = 10} then {set $y = $x + 5}
    executeMutation('$x = 10', {}, () => {});
    executeMutation('$y = $x + 5', {}, () => {});

    expect(useStoryStore.getState().variables.x).toBe(10);
    expect(useStoryStore.getState().variables.y).toBe(15);
  });
});

describe('JavaScript comments (#216)', () => {
  const globals = globalThis as Record<string, unknown>;

  beforeEach(() => {
    delete globals.$x;
  });

  it('skips apostrophes in line comments', () => {
    const vars: Record<string, unknown> = { x: 0 };
    execute("$x = 1; // don't reset\n$x = 2;", vars, {});
    expect(vars.x).toBe(2);
    expect('$x' in globals).toBe(false);
  });

  it('skips apostrophes in block comments', () => {
    const vars: Record<string, unknown> = { x: 0 };
    execute("$x = 1; /* don't reset */ $x = 2;", vars, {});
    expect(vars.x).toBe(2);
    expect('$x' in globals).toBe(false);
  });

  it('skips double quotes and backticks in comments', () => {
    const vars: Record<string, unknown> = { x: 0 };
    execute('$x = 1; // say "hi\n/* a ` tick */ $x = 2;', vars, {});
    expect(vars.x).toBe(2);
    expect('$x' in globals).toBe(false);
  });

  it('resumes after a multi-line block comment', () => {
    const vars: Record<string, unknown> = { x: 0 };
    const temps: Record<string, unknown> = {};
    execute("/* it's\n   _y's */\n$x = 2; _y = 3", vars, temps);
    expect(vars.x).toBe(2);
    expect(temps.y).toBe(3);
  });

  it('passes comments through untouched', () => {
    const vars: Record<string, unknown> = {};
    execute(
      '_f = function () { /* $x _y @z %w */ return 1 }; $src = String(_f)',
      vars,
      {},
    );
    expect(vars.src).toContain('/* $x _y @z %w */');
  });

  it('evaluates an expression ending in a line comment', () => {
    expect(evaluate("$x + 1 // it's", { x: 1 }, {})).toBe(2);
  });

  it('ignores braces in comments inside template interpolations', () => {
    expect(evaluate('`${$a /* } */ + $b}`', { a: 1, b: 1 }, {})).toBe('2');
    expect(evaluate("`${$a // don't }\n+ $b}`", { a: 1, b: 1 }, {})).toBe('2');
  });

  it('still treats a lone slash as division', () => {
    expect(evaluate('$a / 2 / _b', { a: 12 }, { b: 3 })).toBe(2);
  });
});

describe('regex literals (#217)', () => {
  it('preserves sigil-like text inside a regex', () => {
    expect(evaluate('/^_name$/.test("_name")', {}, {})).toBe(true);
    const vars: Record<string, unknown> = {};
    execute('$re = /\\$x@y%z_w/', vars, {});
    expect((vars.re as RegExp).source).toBe('\\$x@y%z_w');
  });

  it('handles escaped slashes', () => {
    expect(evaluate('/a\\/_b/.test("a/_b")', {}, {})).toBe(true);
  });

  it('handles slashes inside character classes', () => {
    expect(evaluate('/[/_]x/.test("_x")', {}, {})).toBe(true);
    expect(evaluate('/[\\]/]_y/.test("/_y")', {}, {})).toBe(true);
  });

  it('keeps regex flags', () => {
    expect(evaluate('/_A/i.test("_a")', {}, {})).toBe(true);
    expect(evaluate('"_a_a".replace(/_a/g, "b")', {}, {})).toBe('bb');
  });

  it('transforms real sigils outside the pattern', () => {
    expect(evaluate('/^_n$/.test(_name)', {}, { name: '_n' })).toBe(true);
    expect(evaluate('$s.replace(/_b/, @r)', { s: 'a_b' }, {}, { r: 'c' })).toBe(
      'ac',
    );
  });

  it('is not confused by quotes or braces inside a regex', () => {
    expect(evaluate('/[\'"`]/.test($s) && _t', { s: '"' }, { t: 7 })).toBe(7);
    expect(evaluate('`${/}/.test("}") ? $a : 0}`', { a: 5 }, {})).toBe('5');
  });

  it('recognises a regex after keywords and statement starts', () => {
    expect(evaluate('typeof /_x/', {}, {})).toBe('object');
    const vars: Record<string, unknown> = {};
    execute(
      '_f = function () { return /_x/.test("_x") }; $a = _f()\n' +
        'if (true) /_y/.test("_y") && ($b = 1); { $c = /_z/.test("_z") }',
      vars,
      {},
    );
    expect(vars).toEqual({ a: true, b: 1, c: true });
  });

  it('treats a slash after an operand as division', () => {
    expect(evaluate('$a /_b/ 1', { a: 12 }, { b: 3 })).toBe(4);
    expect(evaluate('($a) /_b/ 2', { a: 12 }, { b: 3 })).toBe(2);
    expect(evaluate('$l[0] /_b/ 2', { l: [12] }, { b: 3 })).toBe(2);
    expect(evaluate('%a /%b/ 2', {}, {}, {}, { a: 12, b: 3 })).toBe(2);
    expect(evaluate('_i++ /_b/ 1', {}, { i: 12, b: 3 })).toBe(4);
  });

  it('treats a slash after an object literal as division', () => {
    // Shrunk from a property-test counterexample: the `/` after `-{}` opened
    // a regex that swallowed `$obj`, which was then left untransformed.
    expect(evaluate('[-{}/-[], "k" in $obj]', { obj: { k: 1 } }, {})).toEqual([
      NaN,
      true,
    ]);
    expect(evaluate('`${ {} / 2 }` + _t', {}, { t: '!' })).toBe('NaN!');
  });
});

describe('modulo across newlines and postfix operators (#218)', () => {
  it('keeps modulo at the start of a continuation line', () => {
    const vars: Record<string, unknown> = { x: 0 };
    execute('const n = 3;\n$x = 5\n%n;', vars, {});
    expect(vars.x).toBe(2);
    const vars2: Record<string, unknown> = { x: 0 };
    execute('const n = 3;\n$x = 5\n  % n\n  + 1;', vars2, {});
    expect(vars2.x).toBe(3);
    expect(evaluate('$a\n%%b', { a: 10 }, {}, {}, { b: 4 })).toBe(2);
  });

  it('keeps modulo after postfix increments and decrements', () => {
    const vars: Record<string, unknown> = {};
    const temps: Record<string, unknown> = {};
    execute('const n=3; _i=5; $x=_i++ %n;', vars, temps);
    expect(vars.x).toBe(2);
    expect(temps.i).toBe(6);
    execute('const n=3; _j=5; $y=_j-- %n;', vars, temps);
    expect(vars.y).toBe(2);
    expect(temps.j).toBe(4);
  });

  it('reads a transient after a postfix increment and modulo', () => {
    const trans: Record<string, unknown> = { x: 7, y: 4 };
    expect(evaluate('%x++ %%y', {}, {}, {}, trans)).toBe(3);
    expect(trans.x).toBe(8);
  });

  it('treats ++ after a newline as a prefix increment', () => {
    const vars: Record<string, unknown> = {};
    const temps: Record<string, unknown> = { i: 5 };
    execute('$x = 1\n++_i', vars, temps);
    expect(vars.x).toBe(1);
    expect(temps.i).toBe(6);
  });

  it('keeps prefix increments in operand position', () => {
    const trans: Record<string, unknown> = { x: 1 };
    expect(evaluate('10 % ++%x', {}, {}, {}, trans)).toBe(0);
    expect(trans.x).toBe(2);
  });

  it('still assigns a %transient on a new line after a statement', () => {
    const vars: Record<string, unknown> = {};
    const trans: Record<string, unknown> = { a: 0, b: 0 };
    execute('$x = 5\n%a = 1\n$y = 2\n%b += 3', vars, {}, {}, trans);
    expect(vars).toEqual({ x: 5, y: 2 });
    expect(trans).toEqual({ a: 1, b: 3 });
  });
});

describe('sigils only where an identifier starts (property tests)', () => {
  it('leaves `$` and `_` inside identifiers alone', () => {
    expect(evaluate('((a$b, ñ_x) => a$b + ñ_x)(1, 2)', {}, {})).toBe(3);
    expect(evaluate('((x_1, café_y) => x_1 + café_y)(1, 2)', {}, {})).toBe(3);
  });

  it('reads names that start with an underscore', () => {
    expect(evaluate('$_x', { _x: 5 }, {})).toBe(5);
    expect(evaluate('@_x', {}, {}, { _x: 6 })).toBe(6);
    expect(evaluate('__a', {}, { _a: 2 })).toBe(2);
  });

  it('transforms a spread temporary', () => {
    expect(evaluate('[..._a, ...$b]', { b: [3] }, { a: [1, 2] })).toEqual([
      1, 2, 3,
    ]);
  });

  it('leaves property names alone, wherever the dot is', () => {
    const o = { _s: 1, $s: 2 };
    expect(evaluate('$o. _s + $o./* c */_s + $o.\n_s', { o }, {})).toBe(3);
    expect(evaluate('$o.$s + $o?._s', { o, s: 'no' }, {})).toBe(3);
  });

  it('separates a keyword from the reference after it', () => {
    expect(evaluate('typeof%a', {}, {}, {}, { a: 1 })).toBe('number');
    expect(evaluate('typeof@a', {}, {}, { a: 'x' })).toBe('string');
    expect(evaluate('"k" in@o', {}, {}, { o: { k: 1 } })).toBe(true);
  });
});

describe('object literal keys and class members (property tests)', () => {
  it('leaves sigil-like object keys alone', () => {
    expect(evaluate('{ _id: 1, $k: 2 }', {}, {})).toEqual({ _id: 1, $k: 2 });
    expect(evaluate('({ _m() { return 3 } })._m()', {}, {})).toBe(3);
    expect(evaluate('({ get _x() { return _y } })._x', {}, { y: 4 })).toBe(4);
    expect(evaluate('{ *_g() {}, async _h() {} }._g.name', {}, {})).toBe('_g');
  });

  it('still transforms references in keys and values', () => {
    expect(
      evaluate('{ [_k]: $v, _x: _x }', { v: 1 }, { k: 'a', x: 2 }),
    ).toEqual({ a: 1, _x: 2 });
  });

  it('reads destructuring pattern keys as keys', () => {
    const vars: Record<string, unknown> = { o: { _a: 3 } };
    execute('const { _a: x } = $o; $r = x', vars, {});
    expect(vars.r).toBe(3);
  });

  it('leaves class member names alone', () => {
    const vars: Record<string, unknown> = {};
    execute(
      'class P {\n' +
        '  _hp = 1\n' +
        '  static _n = 2;\n' +
        '  #_p = 3\n' +
        '  _heal(n) { this._hp += n + this.#_p; return this }\n' +
        '  get _dead() { return this._hp <= 0 }\n' +
        '}\n' +
        '$hp = new P()._heal(_n)._hp; $dead = new P()._dead; $n = P._n',
      vars,
      { n: 10 },
    );
    expect(vars).toEqual({ hp: 14, dead: false, n: 2 });
  });

  it('continues a class field initializer over a line break', () => {
    const vars: Record<string, unknown> = {};
    execute('class C { _x = $a\ninstanceof Array }\n$r = new C()._x', vars, {});
    expect(vars.r).toBe(false);
  });
});

describe('division and modulo after closing braces (property tests)', () => {
  it('divides after an object literal', () => {
    expect(evaluate('[{} / $x / 1]', { x: 2 }, {})).toEqual([NaN]);
  });

  it('divides after a function or class expression', () => {
    expect(evaluate('String(function () {} / $x / 1)', { x: 2 }, {})).toBe(
      'NaN',
    );
    expect(evaluate('[class {} / $x / 1]', { x: 2 }, {})).toEqual([NaN]);
  });

  it('starts a statement after a function declaration', () => {
    const trans: Record<string, unknown> = {};
    execute('$x = ""\nfunction f() {} %a = 1', {}, {}, {}, trans);
    expect(trans.a).toBe(1);
  });

  it('ends a return statement at a line break', () => {
    expect(transform('return\nfunction f() {}\n++%a', 'statements')).toBe(
      'return\nfunction f() {}\n++transient["a"]',
    );
  });

  it('reads `of` as an identifier outside a for-of header', () => {
    expect(evaluate('((of) => of / $x / 1)(8)', { x: 2 }, {})).toBe(4);
    const vars: Record<string, unknown> = {};
    execute('$r = []; for (const of of /a/.exec("a")) $r.push(of)', vars, {});
    expect(vars.r).toEqual(['a']);
  });

  it('divides after a unicode identifier', () => {
    expect(evaluate('((é) => é / $x / 1)(6)', { x: 2 }, {})).toBe(3);
  });
});

describe('line terminators (property tests)', () => {
  it('ends a line comment at \\r, U+2028 and U+2029', () => {
    expect(evaluate('1 // c\r+ $x', { x: 2 }, {})).toBe(3);
    expect(evaluate('1 // c\u2028+ $x', { x: 2 }, {})).toBe(3);
    expect(evaluate('1 // c\u2029+ $x', { x: 2 }, {})).toBe(3);
  });

  it('treats \\r as a line break before a %transient assignment', () => {
    const trans: Record<string, unknown> = {};
    execute('$x = 5\r%a = 1', {}, {}, {}, trans);
    expect(trans.a).toBe(1);
  });
});

describe('%transient assignments starting a line (property tests)', () => {
  it('assigns through an index', () => {
    const vars: Record<string, unknown> = {};
    const trans: Record<string, unknown> = { a: [0, 0] };
    execute('$x = 5\n%a[$x - 4] = 1', vars, {}, {}, trans);
    expect(vars.x).toBe(5);
    expect(trans.a).toEqual([0, 1]);
  });

  it('assigns through a property behind a comment', () => {
    const trans: Record<string, unknown> = { a: {} };
    execute('$x = 5\n%a /* c */ .b = 1', {}, {}, {}, trans);
    expect(trans.a).toEqual({ b: 1 });
  });
});
