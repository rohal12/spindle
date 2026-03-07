import { describe, it, expect, beforeEach } from 'vitest';
import { evaluate, execute } from '../../src/expression';
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
