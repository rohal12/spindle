import { describe, it, expect, afterEach } from 'vitest';
import type { ActionType, StoryAction } from '../../src/action-registry';
import {
  observe,
  filterObservedActions,
  setObservedActions,
  _resetObservedActions,
} from '../../src/observe/observe';

const action = (type: ActionType, label: string = type): StoryAction => ({
  id: `${type}:${label}`,
  type,
  label,
  perform: () => {},
});

const ACTIONS: StoryAction[] = [
  action('link', 'Shop'),
  action('back'),
  action('forward'),
  action('restart'),
  action('save'),
  action('load'),
  action('dialog', 'Saves'),
  action('open-dialog', 'Stats'),
  action('open-dialog', 'Map'),
];

const ids = (rules: Parameters<typeof filterObservedActions>[1]) =>
  filterObservedActions(ACTIONS, rules).map((a) => a.id);

describe('filterObservedActions', () => {
  it('leaves out history, restart, save, load and menubar dialogs by default', () => {
    expect(ids({})).toEqual([
      'link:Shop',
      'open-dialog:Stats',
      'open-dialog:Map',
    ]);
  });

  it('puts back what an include rule matches', () => {
    expect(ids({ include: [{ type: 'restart' }] })).toContain(
      'restart:restart',
    );
  });

  it('removes only what an exclude rule matches', () => {
    expect(ids({ exclude: [{ type: 'open-dialog', label: 'Stats' }] })).toEqual(
      ['link:Shop', 'open-dialog:Map'],
    );
  });

  it('lets exclude win over include', () => {
    expect(
      ids({ exclude: [{ type: 'restart' }], include: [{ type: 'restart' }] }),
    ).not.toContain('restart:restart');
  });

  it('returns the actions without perform', () => {
    for (const a of filterObservedActions(ACTIONS, {})) {
      expect(a).not.toHaveProperty('perform');
    }
    expect(() =>
      structuredClone(filterObservedActions(ACTIONS, {})),
    ).not.toThrow();
  });

  it('copies JSON values so changing an observation cannot mutate the action (#578)', () => {
    const value = { items: [1, 'two', true, null] };
    const original = { ...action('textbox'), value };
    const seen = filterObservedActions([original], {})[0]!;
    expect(seen.value).toEqual(value);
    expect(seen.value).not.toBe(value);
    (seen.value as typeof value).items.push(3);
    expect(value.items).toHaveLength(4);
    expect(JSON.parse(JSON.stringify(seen))).toEqual(seen);
    expect(() => structuredClone(seen)).not.toThrow();
  });

  it('describes non-JSON values without exposing live objects or functions (#578)', () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    const throwing = Object.defineProperty({}, 'bad', {
      enumerable: true,
      get() {
        throw new Error('unreadable');
      },
    });
    const cases: [unknown, string][] = [
      [1n, '1n'],
      [{ n: 1n }, '{"n":1n}'],
      [cycle, '{"self":<ref 0>}'],
      [Symbol('secret'), 'Symbol("secret")'],
      [Infinity, 'Infinity'],
      [NaN, 'NaN'],
      [new Map([['key', 1n]]), 'Map[["key",1n]]'],
      [throwing, '<unkeyable>'],
    ];
    for (const [value, expected] of cases) {
      const seen = filterObservedActions(
        [{ ...action('textbox'), value }],
        {},
      )[0]!;
      expect(seen.value).toBe(expected);
      expect(JSON.parse(JSON.stringify(seen))).toEqual(seen);
      expect(() => structuredClone(seen)).not.toThrow();
    }
  });
});

describe('setObservedActions', () => {
  afterEach(() => _resetObservedActions());

  it.each([
    ['a non-object', 'restart'],
    ['a non-list exclude', { exclude: { type: 'link' } }],
    ['an unknown field', { includ: [] }],
    ['a null matcher', { include: [null] }],
    ['an unknown matcher field', { exclude: [{ typ: 'link' }] }],
    ['a non-string matcher type', { include: [{ type: 3 }] }],
    ['a non-boolean disabled', { exclude: [{ disabled: 'yes' }] }],
  ])('rejects %s', (_label, rules) => {
    expect(() => setObservedActions(rules as never)).toThrow(/^spindle: /);
  });

  it('names the rule that failed', () => {
    expect(() =>
      setObservedActions({
        exclude: [{ type: 'link' }, { typ: 'link' } as never],
      }),
    ).toThrow(/exclude\[1\]/);
  });

  it('accepts valid rules', () => {
    expect(() =>
      setObservedActions({
        exclude: [{ type: 'open-dialog', label: 'Stats' }],
        include: [{ type: 'restart', disabled: false }],
      }),
    ).not.toThrow();
  });
});

describe('observe', () => {
  it('throws before a passage is on screen', () => {
    // No DOM here: it throws before it would mount StoryContext
    expect(() => observe()).toThrow(
      'spindle: Story.observe() needs a mounted story',
    );
  });
});
