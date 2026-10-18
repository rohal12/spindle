import { describe, expect, it, vi } from 'vitest';
import { serialize, deserialize } from '../../src/class-registry';
import {
  decodePayload,
  encodePayload,
  IncompatibleSaveError,
  SAVE_FORMAT_VERSION,
} from '../../src/saves/format';
import { checkSaveExport } from '../../src/saves/types';
import type { SavePayload } from '../../src/saves/types';

const payload = (): SavePayload => ({
  passage: 'B',
  variables: { hp: 1 },
  history: [
    { passage: 'A', variables: { hp: 2 }, timestamp: 1, prng: null },
    { passage: 'B', variables: { hp: 1 }, timestamp: 2, prng: null },
  ],
  historyIndex: 1,
  visitCounts: { A: 1, B: 1 },
  renderCounts: { A: 1, B: 1 },
});

/** The encoded payload with its decoded body changed by `edit`. */
function tampered(edit: (body: Record<string, any>) => void) {
  const encoded = encodePayload(payload());
  const body = deserialize<Record<string, any>>(encoded.data);
  edit(body);
  return { ...encoded, data: serialize(body) };
}

const exportOf = (encoded: unknown) => ({
  formatVersion: SAVE_FORMAT_VERSION,
  ifid: 'x',
  exportedAt: '',
  save: {
    meta: {
      id: 'i',
      ifid: 'x',
      playthroughId: 'p',
      createdAt: '',
      updatedAt: '',
      title: 't',
      passage: 'B',
      custom: {},
    },
    payload: encoded,
  },
});

describe('save format v2: the envelope rejects what it cannot load', () => {
  it.each([
    ['a story variable', (a: unknown[]) => a],
    ['an object field', (a: unknown[]) => ({ items: a })],
    ['a Map key', (a: unknown[]) => new Map([[a, 1]])],
    ['a Map value', (a: unknown[]) => new Map([['items', a]])],
    ['a Set member', (a: unknown[]) => new Set([a])],
    [
      'an Error cause',
      (a: unknown[]) => Object.assign(new Error('items'), { cause: a }),
    ],
    [
      'an Error message',
      (a: unknown[]) =>
        Object.defineProperty(new Error('items'), 'message', { value: a }),
    ],
    [
      'an Error field',
      (a: unknown[]) => Object.assign(new Error('items'), { items: a }),
    ],
    [
      'a non-enumerable array index',
      (a: unknown[]) => Object.defineProperty([], '0', { value: a }),
    ],
  ])('rejects an excessive sparse array in %s (#591)', (_name, hold) => {
    const items = new Array(0xffffffff);
    const bad = tampered((body) => {
      body.history[0].variables.items = hold(items);
    });
    expect(() => decodePayload(bad)).toThrow(
      'Save arrays cannot exceed 1000000 elements',
    );
    const live = payload();
    live.variables.items = hold(items);
    expect(() => encodePayload(live)).toThrow(
      'Save arrays cannot exceed 1000000 elements',
    );
  });

  it('accepts sparse arrays at the limit and keeps their holes and cycles (#591)', () => {
    const live = payload();
    const items = new Array(1_000_000);
    items[42] = items;
    live.variables.items = items;
    const decoded = decodePayload(encodePayload(live)).variables
      .items as unknown[];
    expect(decoded.length).toBe(items.length);
    expect(Object.keys(decoded)).toEqual(['42']);
    expect(decoded[42]).toBe(decoded);
  });

  it.each(['history', 'watchers'])(
    'rejects sparse %s without expanding it (#584)',
    (field) => {
      const bad = tampered((body) => {
        body[field] = new Array(100_000_000);
      });
      const from = Array.from;
      // Bound allocations during validation without risking an OOM in Vitest.
      const guard = vi.spyOn(Array, 'from').mockImplementation(((
        value: unknown,
        ...args: unknown[]
      ) => {
        if (Array.isArray(value) && value.length >= 100_000)
          throw new Error('Dense allocation exceeded resource budget');
        return Reflect.apply(from, Array, [value, ...args]);
      }) as typeof Array.from);
      try {
        expect(() => decodePayload(bad)).toThrow('Invalid save data');
      } finally {
        guard.mockRestore();
      }
    },
  );

  it.each(['history', 'watchers'])(
    'rejects a hole after a valid %s entry',
    (field) => {
      const bad = tampered((body) => {
        body[field] =
          field === 'history'
            ? [body.history[0]]
            : [{ condition: 'true', options: {} }];
        body[field].length = 2;
      });
      expect(() => decodePayload(bad)).toThrow('Invalid save data');
    },
  );

  it('round-trips a payload', () => {
    expect(decodePayload(encodePayload(payload()))).toEqual(payload());
  });

  it.each([
    ['history index out of range', (b: any) => (b.historyIndex = 5)],
    [
      'history index at a moment of another passage',
      (b: any) => (b.historyIndex = 0),
    ],
    ['a moment without a passage', (b: any) => delete b.history[0].passage],
    ['empty history', (b: any) => (b.history = [])],
    ['variables that are no object', (b: any) => (b.variables = 3)],
    [
      'a malformed PRNG snapshot',
      (b: any) => (b.history[0].prng = { seed: 1 }),
    ],
  ])('%s', (_, edit) => {
    const bad = tampered(edit);
    expect(() => decodePayload(bad)).toThrow('Invalid save data');
    expect(() => checkSaveExport(exportOf(bad))).toThrow(
      'Invalid save file format',
    );
  });

  it('refuses malformed serialized text', () => {
    const bad = { formatVersion: SAVE_FORMAT_VERSION, data: '[{"a":7}]' };
    expect(() => decodePayload(bad)).toThrow();
    expect(() => checkSaveExport(exportOf(bad))).toThrow(
      'Invalid save file format',
    );
  });

  it('refuses saves of another format version', () => {
    const newer = { ...encodePayload(payload()), formatVersion: 99 };
    expect(() => decodePayload(newer)).toThrow(IncompatibleSaveError);
    expect(() =>
      checkSaveExport({ ...exportOf(newer), formatVersion: 99 }),
    ).toThrow(IncompatibleSaveError);
    // An export from before versioning
    expect(() => checkSaveExport({ version: 1, ifid: 'x', save: {} })).toThrow(
      IncompatibleSaveError,
    );
    expect(() => checkSaveExport({ foo: 1 })).toThrow(
      'Invalid save file format',
    );
  });
});

describe('serialize/deserialize v2', () => {
  it('never sets a prototype from a "__proto__" key in saved text', () => {
    expect(() => deserialize('[{"__proto__":1},{"polluted":2}]')).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('keeps one-character escaped keys (V8 JSON.parse key bug guard)', () => {
    deserialize(serialize({ zz: 1, '\\': 1 }));
    const back = deserialize<Record<string, number>>(
      serialize({ zz: 2, '"': 2 }),
    );
    expect(Object.keys(back)).toEqual(['zz', '"']);
  });

  it('refuses what a save cannot hold, naming the path', () => {
    expect(() => serialize({ a: { f: () => 1 } })).toThrow(
      /Cannot save a function \(at .*a.*f/,
    );
    class Unknown {}
    expect(() => serialize({ u: new Unknown() })).toThrow(/"Unknown"/);
    expect(() => serialize({ s: Symbol('x') })).toThrow(/unique symbol/);
  });
});
