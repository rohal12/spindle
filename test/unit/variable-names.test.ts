// @vitest-environment happy-dom
/**
 * Variable names that are also Object.prototype members (`constructor`,
 * `toString`, `hasOwnProperty`, `valueOf`, ...) are plain storage in every
 * namespace, and reading one that was never set gives undefined. A variable
 * named `__proto__` is refused with an error wherever a name enters.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useStoryStore, type StoryState } from '../../src/store';
import { evaluate, execute } from '../../src/expression';
import { executeMutation } from '../../src/execute-mutation';
import {
  installStoryAPI,
  setDeclaredVariables,
  _resetDeclaredVariables,
} from '../../src/story-api';
import { deserialize, serialize } from '../../src/class-registry';
import { interpolate } from '../../src/interpolation';
import {
  parseStoryVariables,
  extractDefaults,
  validatePassages,
} from '../../src/story-variables';
import { resetEmitter } from '../../src/event-emitter';
import type { StoryData, Passage } from '../../src/parser';

const INHERITED = [
  'constructor',
  'toString',
  'hasOwnProperty',
  'valueOf',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  '__defineGetter__',
  '__lookupSetter__',
];

function makePassage(pid: number, name: string, content: string): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(): StoryData {
  const passages = [makePassage(1, 'Start', ''), makePassage(2, 'Room', '')];
  return {
    name: 'Test',
    startNode: 1,
    ifid: 'variable-names',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
}

const state = () => useStoryStore.getState();
const story = () => window.Story;

beforeEach(() => {
  resetEmitter();
  _resetDeclaredVariables();
  state().init(makeStoryData(), { n: 0 }, { t: 0 });
  installStoryAPI();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('expressions', () => {
  it.each(INHERITED)(
    'read an unset $%s as undefined in every namespace',
    (name) => {
      for (const sigil of ['$', '_', '@', '%']) {
        expect(evaluate(`typeof ${sigil}${name}`, {}, {}, {}, {})).toBe(
          'undefined',
        );
      }
    },
  );

  it('read unset inherited names from the store namespaces as undefined', () => {
    const { variables, temporary, transient } = state();
    expect(
      evaluate(
        '[$toString, _constructor, %valueOf]',
        variables,
        temporary,
        {},
        transient,
      ),
    ).toEqual([undefined, undefined, undefined]);
  });

  it.each(INHERITED)('store $%s as a plain value', (name) => {
    const ns = {};
    execute(
      `$${name} = 5; _${name} = 6; @${name} = 7; %${name} = 8`,
      ns,
      ns,
      ns,
      ns,
    );
    expect(Object.getOwnPropertyDescriptor(ns, name)?.value).toBe(8);
    expect(evaluate(`$${name} + 1`, ns, {}, {}, {})).toBe(9);
  });

  it.each(['$', '_', '@', '%'])(
    'refuse %s__proto__ before running anything',
    (sigil) => {
      const ns: Record<string, unknown> = {};
      expect(() =>
        execute(`$a = 1; ${sigil}__proto__ = { polluted: 1 }`, ns, ns, ns, ns),
      ).toThrow(SyntaxError);
      expect(() => evaluate(`${sigil}__proto__`, ns, ns, ns, ns)).toThrow(
        /__proto__/,
      );
      expect(ns).toEqual({});
      expect(Object.getPrototypeOf(ns)).not.toHaveProperty('polluted');
    },
  );

  it('still allows __proto__ as a property name below a variable', () => {
    expect(evaluate('$o.__proto__ === Object.prototype', { o: {} }, {})).toBe(
      true,
    );
  });

  it('interpolate reads unset inherited names as empty', () => {
    expect(
      interpolate(
        '[{$toString}{_valueOf}{@constructor}{%hasOwnProperty}]',
        {},
        {},
        {},
        {},
      ),
    ).toBe('[]');
  });
});

describe('store namespaces', () => {
  const namespaces = () => [
    state().variables,
    state().temporary,
    state().transient,
  ];

  it('have no prototype after every kind of update', () => {
    const check = () => {
      for (const ns of namespaces())
        expect(Object.getPrototypeOf(ns)).toBe(null);
    };
    check();
    state().setVariable('constructor', 1);
    state().setTemporary('toString', 2);
    check();
    useStoryStore.setState({
      variables: { a: 1 },
      temporary: {},
      transient: {},
    });
    check();
    useStoryStore.setState((s) => {
      s.variables = { b: 1 };
      s.temporary = {};
    });
    check();
    state().navigate('Room');
    check();
    state().goBack();
    check();
    state().goForward();
    check();
    state().restart();
    check();
    state().loadFromPayload(deserialize(serialize(state().getSavePayload())));
    check();
    expect(Object.getPrototypeOf(state().getHistoryVariables(0))).toBe(null);
  });

  it('refuse a variable named __proto__ in the store actions', () => {
    expect(() => state().setVariable('__proto__', { x: 1 })).toThrow(TypeError);
    expect(() => state().setTemporary('__proto__', { x: 1 })).toThrow(
      TypeError,
    );
    expect(() => state().setTransient('__proto__', { x: 1 })).toThrow(
      TypeError,
    );
    expect(() => state().deleteVariable('__proto__')).toThrow(TypeError);
    expect(state().variables.x).toBeUndefined();
  });

  it('keep inherited names through navigation, history and saves', () => {
    executeMutation(
      '$constructor = 1; $toString = "s"; _valueOf = 2',
      {},
      () => {},
    );
    expect(state().variables.constructor).toBe(1);
    expect(state().temporary.valueOf).toBe(2);
    state().navigate('Room');
    executeMutation('$constructor = 2', {}, () => {});
    state().navigate('Start');
    state().goBack();
    expect(state().variables.constructor).toBe(1);
    state().goForward();
    expect(state().variables.constructor).toBe(2);

    const payload = deserialize<ReturnType<StoryState['getSavePayload']>>(
      JSON.parse(JSON.stringify(serialize(state().getSavePayload()))),
    );
    state().restart();
    expect(state().variables.constructor).toBeUndefined();
    state().loadFromPayload(payload);
    expect(state().variables.constructor).toBe(2);
    expect(state().variables.toString).toBe('s');
  });
});

describe('history of inherited names', () => {
  it('records their removal across a save and load', () => {
    executeMutation('$toString = 1', {}, () => {});
    state().navigate('Room');
    executeMutation('delete $toString', {}, () => {});
    state().navigate('Start');
    const payload = deserialize<ReturnType<StoryState['getSavePayload']>>(
      JSON.parse(JSON.stringify(serialize(state().getSavePayload()))),
    );
    state().loadFromPayload(payload);
    expect(Object.keys(state().getHistoryVariables(1))).toContain('toString');
    expect(Object.keys(state().getHistoryVariables(2))).not.toContain(
      'toString',
    );
    state().goBack();
    expect(Object.keys(state().variables)).toContain('toString');
    state().goForward();
    expect(Object.keys(state().variables)).not.toContain('toString');
  });
});

describe('mutation code', () => {
  it('commits writes to inherited names and reads unset ones as undefined', () => {
    executeMutation(
      '_r = [typeof $hasOwnProperty, typeof _toString, typeof %valueOf]; $hasOwnProperty = 1; %valueOf = 3',
      {},
      () => {},
    );
    expect(state().temporary.r).toEqual([
      'undefined',
      'undefined',
      'undefined',
    ]);
    expect(Object.keys(state().variables)).toContain('hasOwnProperty');
    expect(state().variables.hasOwnProperty).toBe(1);
    expect(state().transient.valueOf).toBe(3);
  });

  it('reads unset inherited locals as undefined and keeps written ones', () => {
    const update = vi.fn();
    executeMutation('_r = typeof @toString; @constructor = 4', {}, update);
    expect(state().temporary.r).toBe('undefined');
    expect(update).toHaveBeenCalledWith('constructor', 4);
  });
});

describe('Story API', () => {
  it('stores and reads inherited names as plain variables', () => {
    expect(story().get('toString')).toBeUndefined();
    expect(story().get('$constructor')).toBeUndefined();
    expect(story().get('%valueOf')).toBeUndefined();
    story().set('constructor', 1);
    story().set({ toString: 2, '%valueOf': 3 });
    expect(story().get('constructor')).toBe(1);
    expect(story().get('toString')).toBe(2);
    expect(story().get('%valueOf')).toBe(3);
  });

  it('reads unset inherited names as undefined inside mutation code', () => {
    executeMutation('_r = Story.get("hasOwnProperty")', {}, () => {});
    expect(state().temporary.r).toBeUndefined();
  });

  it('refuses a variable named __proto__', () => {
    expect(() => story().set('__proto__', { x: 1 })).toThrow(TypeError);
    expect(() => story().set('%__proto__', { x: 1 })).toThrow(TypeError);
    expect(() =>
      story().set(
        JSON.parse('{"__proto__": {"x": 1}}') as Record<string, unknown>,
      ),
    ).toThrow(TypeError);
    expect(() => story().get('__proto__')).toThrow(TypeError);
    expect(state().variables.x).toBeUndefined();
  });

  it('reports a new inherited-name variable as changed from undefined', () => {
    const events: Record<string, { from: unknown; to: unknown }>[] = [];
    story().on('variableChanged', (changed) => events.push(changed));
    story().set('toString', 1);
    expect(events).toEqual([{ toString: { from: undefined, to: 1 } }]);
  });

  it('warns about undeclared inherited names', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setDeclaredVariables(['n'], ['t']);
    story().set('constructor', 1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('$constructor'));
  });
});

describe('StoryVariables', () => {
  it('declares inherited names as plain variables', () => {
    const schema = parseStoryVariables('$constructor = 1\n$toString = "x"');
    const defaults = extractDefaults(schema);
    expect(Object.getPrototypeOf(defaults)).toBe(null);
    expect(defaults).toEqual({ constructor: 1, toString: 'x' });
    expect(Object.keys(defaults)).toEqual(['constructor', 'toString']);
  });

  it('refuses a variable named __proto__', () => {
    expect(() => parseStoryVariables('$__proto__ = { x: 1 }')).toThrow(
      /StoryVariables.*__proto__/,
    );
    expect(() => parseStoryVariables('%__proto__ = 1', '%')).toThrow(
      /StoryTransients.*__proto__/,
    );
  });

  it('validates references to inherited names like any other', () => {
    const schema = parseStoryVariables('$constructor = { hp: 1 }');
    const passage = (content: string) =>
      new Map([['P', { pid: 1, name: 'P', tags: [], metadata: {}, content }]]);
    expect(validatePassages(passage('{$constructor.hp}'), schema)).toEqual([]);
    expect(validatePassages(passage('{$toString}'), schema)).toEqual([
      'Passage "P": Undeclared variable: $toString',
    ]);
    expect(validatePassages(passage('{$__proto__}'), schema)).toEqual([
      'Passage "P": "$__proto__" cannot be used as a variable name (__proto__ is reserved)',
    ]);
  });

  it('validates references in attribute values and labels the same way', () => {
    const schema = parseStoryVariables('$constructor = { hp: 1 }');
    const passage = (content: string) =>
      new Map([['P', { pid: 1, name: 'P', tags: [], metadata: {}, content }]]);
    expect(
      validatePassages(
        passage(
          '<b title="{$constructor.hp}{print $constructor}" onclick="f({$constructor})">x</b>{button "{$constructor.hp}"}{/button}',
        ),
        schema,
      ),
    ).toEqual([]);
    for (const content of [
      '<b title="{$toString}">x</b>',
      '<b title="{if $toString}x{/if}">x</b>',
      '<b onclick="f({$toString})">x</b>',
    ]) {
      expect(validatePassages(passage(content), schema), content).toEqual([
        'Passage "P": Undeclared variable: $toString',
      ]);
    }
    for (const content of [
      '<b title="{$__proto__}">x</b>',
      '<b title="{print $__proto__}">x</b>',
      '<b onclick="f({$__proto__})">x</b>',
    ]) {
      expect(validatePassages(passage(content), schema), content).toEqual([
        'Passage "P": "$__proto__" cannot be used as a variable name (__proto__ is reserved)',
      ]);
    }
  });
});
