import { describe, expect, it } from 'vitest';
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
