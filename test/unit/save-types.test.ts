import { describe, it, expect } from 'vitest';
import { isSaveExport } from '../../src/saves/types';
import type { SavePayload } from '../../src/saves/types';
import { editStored, editStoredRaw } from '../support/encoded-payload';
import {
  decodePayload,
  encodePayload,
  SAVE_FORMAT_VERSION,
  type EncodedPayload,
} from '../../src/saves/format';

function validPayload(): SavePayload {
  return {
    passage: 'Start',
    variables: { hp: 100 },
    history: [{ passage: 'Start', variables: {}, timestamp: 1 }],
    historyIndex: 0,
  };
}

function makeValidExport() {
  return {
    formatVersion: SAVE_FORMAT_VERSION,
    ifid: 'test-ifid',
    exportedAt: new Date().toISOString(),
    save: {
      meta: {
        id: 'save-1',
        ifid: 'test-ifid',
        playthroughId: 'pt-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        title: 'Test Save',
        passage: 'Start',
        custom: {},
      },
      payload: encodePayload(validPayload()) as EncodedPayload,
    },
  };
}

/** A valid export whose payload `edit` changed (see editStored). */
function withPayload(edit: (payload: Record<string, any>) => void) {
  const data = makeValidExport();
  data.save.payload = editStored(data.save.payload, edit);
  return data;
}

/** A valid export with a raw devalue entry in its payload (see editStoredRaw). */
function withRawValue(
  edit: (payload: Record<string, any>) => void,
  raw: string,
) {
  const data = makeValidExport();
  data.save.payload = editStoredRaw(data.save.payload, edit, raw);
  return data;
}

describe('isSaveExport', () => {
  it('returns true for valid export', () => {
    expect(isSaveExport(makeValidExport())).toBe(true);
  });

  it('returns false for null', () => {
    expect(isSaveExport(null)).toBe(false);
  });

  it('returns false for non-object', () => {
    expect(isSaveExport('string')).toBe(false);
    expect(isSaveExport(42)).toBe(false);
    expect(isSaveExport(undefined)).toBe(false);
  });

  it('returns false for another format version', () => {
    const data = makeValidExport();
    (data as any).formatVersion = SAVE_FORMAT_VERSION + 1;
    expect(isSaveExport(data)).toBe(false);
    const payload = makeValidExport();
    (payload as any).save.payload.formatVersion = SAVE_FORMAT_VERSION + 1;
    expect(isSaveExport(payload)).toBe(false);
  });

  it('returns false for an export from before format versions', () => {
    const data: any = makeValidExport();
    delete data.formatVersion;
    data.version = 1;
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for missing ifid', () => {
    const data = makeValidExport();
    delete (data as any).ifid;
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for non-string ifid', () => {
    const data = makeValidExport();
    (data as any).ifid = 123;
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for null save', () => {
    const data = makeValidExport();
    (data as any).save = null;
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for missing save.meta', () => {
    const data = makeValidExport();
    delete (data as any).save.meta;
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for null save.meta', () => {
    const data = makeValidExport();
    (data as any).save.meta = null;
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for missing save.payload', () => {
    const data = makeValidExport();
    delete (data as any).save.payload;
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for null save.payload', () => {
    const data = makeValidExport();
    (data as any).save.payload = null;
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for payload data that is not serialized text', () => {
    const data = makeValidExport();
    (data as any).save.payload.data = validPayload();
    expect(isSaveExport(data)).toBe(false);
    const garbled = makeValidExport();
    garbled.save.payload.data = garbled.save.payload.data.slice(0, -3);
    expect(isSaveExport(garbled)).toBe(false);
  });

  it.each([
    'id',
    'passage',
    'ifid',
    'playthroughId',
    'createdAt',
    'updatedAt',
    'title',
  ])('returns false for non-string meta.%s', (key) => {
    const data = makeValidExport();
    (data as any).save.meta[key] = 123;
    expect(isSaveExport(data)).toBe(false);
  });

  it.each([
    ['non-string payload.passage', (p: any) => (p.passage = 42)],
    ['non-array payload.history', (p: any) => (p.history = 'not-array')],
    ['non-number payload.historyIndex', (p: any) => (p.historyIndex = 'nope')],
    ['null payload.variables', (p: any) => (p.variables = null)],
    ['non-object payload.variables', (p: any) => (p.variables = 'string')],
    ['array payload.variables', (p: any) => (p.variables = [])],
    ['empty payload.history', (p: any) => (p.history = [])],
  ])('returns false for %s', (_, edit) => {
    expect(isSaveExport(makeValidExport())).toBe(true);
    expect(isSaveExport(withPayload(edit))).toBe(false);
  });

  it.each([
    ['null', null],
    ['a string', 'Start'],
    ['missing passage', { variables: {}, timestamp: 1 }],
    ['null variables', { passage: 'Start', variables: null, timestamp: 1 }],
    ['array variables', { passage: 'Start', variables: [], timestamp: 1 }],
    ['missing timestamp', { passage: 'Start', variables: {} }],
    [
      'malformed prng',
      { passage: 'Start', variables: {}, timestamp: 1, prng: { seed: 1 } },
    ],
  ])('returns false for a history moment that is %s', (_, moment) => {
    expect(isSaveExport(withPayload((p) => (p.history = [moment])))).toBe(
      false,
    );
  });

  it('returns false when any history moment is malformed', () => {
    const data = withPayload((p) => {
      p.history = [
        { passage: 'Room', variables: {}, timestamp: 1 },
        null,
        { passage: 'Start', variables: {}, timestamp: 2 },
      ];
      p.historyIndex = 2;
    });
    expect(isSaveExport(data)).toBe(false);
  });

  it.each([
    ['negative', -1],
    ['past the end', 1],
    ['fractional', 0.5],
    ['NaN', NaN],
  ])('returns false for a %s historyIndex', (_, index) => {
    expect(isSaveExport(withPayload((p) => (p.historyIndex = index)))).toBe(
      false,
    );
  });

  it("returns false when the current moment is not the payload's passage", () => {
    expect(isSaveExport(withPayload((p) => (p.passage = 'Room')))).toBe(false);
  });

  it('returns false for a malformed payload.prng', () => {
    expect(isSaveExport(withPayload((p) => (p.prng = 'seed')))).toBe(false);
  });

  it('returns false for malformed visit or render counts', () => {
    expect(isSaveExport(withPayload((p) => (p.visitCounts = 3)))).toBe(false);
    expect(isSaveExport(withPayload((p) => (p.renderCounts = null)))).toBe(
      false,
    );
    expect(
      isSaveExport(withPayload((p) => (p.visitCounts = new Map([[1, 1]])))),
    ).toBe(false);
  });

  it('returns false for a malformed encoded value in the live variables', () => {
    // A Map entry whose value index is past the end
    const data = withRawValue(
      (p) => (p.variables = { inventory: '__BAD__' }),
      '["Map",999,999]',
    );
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for a malformed encoded value in a history moment', () => {
    const data = withRawValue((p) => {
      p.history = [
        { passage: 'Room', variables: { deep: ['__BAD__'] }, timestamp: 1 },
        { passage: 'Start', variables: {}, timestamp: 2 },
      ];
      p.historyIndex = 1;
    }, '["RegExp","(",""]');
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for an instance of a class that is not registered', () => {
    const data = withRawValue(
      (p) => (p.variables = { hero: '__BAD__' }),
      '["c:Unregistered",0]',
    );
    expect(isSaveExport(data)).toBe(false);
  });

  it('accepts well-formed encoded built-in values', () => {
    const data = withPayload((p) => {
      p.variables = {
        seen: new Set(['Start']),
        at: new Date('2024-01-02T03:04:05.000Z'),
      };
      p.history[0].variables = p.variables;
    });
    expect(isSaveExport(data)).toBe(true);
  });

  it('returns false for a history with a hole', () => {
    const data = withPayload((p) => {
      const history = [{ passage: 'Start', variables: {}, timestamp: 1 }];
      history.length = 2;
      history.reverse();
      p.history = history;
      p.historyIndex = 1;
    });
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for a variable or property named __proto__', () => {
    // serialize() refuses the key, so it is written in by hand
    const name = (key: string) =>
      withPayload((p) => (p.variables = { [key]: { a: 1 } }));
    const top = name('__protx__');
    top.save.payload.data = top.save.payload.data.replace(
      '"__protx__"',
      '"__proto__"',
    );
    expect(isSaveExport(name('__protx__'))).toBe(true);
    expect(isSaveExport(top)).toBe(false);

    const nested = withPayload(
      (p) => (p.history[0].variables = { x: { y: { __protx__: 1 } } }),
    );
    nested.save.payload.data = nested.save.payload.data.replace(
      '"__protx__"',
      '"__proto__"',
    );
    expect(isSaveExport(nested)).toBe(false);
  });

  it('accepts a multi-moment history with PRNG snapshots', () => {
    const data = makeValidExport();
    data.save.payload = encodePayload({
      passage: 'Start',
      variables: { hp: 100 },
      history: [
        { passage: 'Room', variables: {}, timestamp: 1, prng: null },
        {
          passage: 'Start',
          variables: { hp: 100 },
          timestamp: 2,
          prng: { seed: 'abc', pull: 3 },
        },
      ],
      historyIndex: 1,
      visitCounts: { Start: 1, Room: 1 },
      renderCounts: { Start: 1, Room: 1 },
      prng: { seed: 'abc', pull: 4 },
    });
    expect(isSaveExport(data)).toBe(true);
  });
});

/** The payload checks isSavePayload() made, now made by decodePayload(). */
describe('decodePayload checks the payload', () => {
  const encodedWith = (edit: (p: Record<string, any>) => void) =>
    withPayload(edit).save.payload;

  it('returns a valid payload', () => {
    expect(decodePayload(encodePayload(validPayload()))).toEqual(
      validPayload(),
    );
  });

  it.each([
    ['null', () => null],
    ['not an envelope', () => validPayload()],
  ])('throws for %s', (_, make) => {
    expect(() => decodePayload(make())).toThrow();
  });

  it.each([
    ['missing passage', (p: any) => delete p.passage],
    ['non-array history', (p: any) => (p.history = {})],
    ['non-number historyIndex', (p: any) => (p.historyIndex = '0')],
    ['null variables', (p: any) => (p.variables = null)],
    ['empty history array', (p: any) => (p.history = [])],
  ])('throws for %s', (_, edit) => {
    expect(() => decodePayload(encodedWith(edit))).toThrow('Invalid save data');
  });
});
