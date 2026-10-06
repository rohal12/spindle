// The stored save format, pinned: a representative save must encode to
// exactly the text in fixtures/save-format-v1.json, and that text must
// decode to the same state. A change of either (for example a devalue
// upgrade that writes or reads differently) fails here.
//
// If the stored form has to change, do not just rewrite the fixture: bump
// SAVE_FORMAT_VERSION, add a migration from the old version to
// MIGRATIONS (src/saves/format.ts), keep the old fixture and check that it
// migrates. To write the fixture of the current version, run this file with
// UPDATE_GOLDEN=1.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { clearRegistry, registerClass } from '../../src/class-registry';
import { deepEqualStrict } from '../../src/structural';
import {
  decodePayload,
  encodePayload,
  SAVE_FORMAT_VERSION,
  type EncodedPayload,
} from '../../src/saves/format';
import type { SavePayload } from '../../src/saves/types';

const FIXTURE = fileURLToPath(
  new URL('./fixtures/save-format-v1.json', import.meta.url),
);

class GoldenHero {
  name: string;
  friend: GoldenHero | null = null;
  bag = new Map<string, unknown>();
  constructor(name: string) {
    this.name = name;
  }
}

class GoldenError extends Error {
  code = 7;
}

/** Every kind of value a save holds, with cycles and shared references. */
function representativePayload(): SavePayload {
  const ada = new GoldenHero('Ada');
  const bo = new GoldenHero('Bo');
  ada.friend = bo;
  bo.friend = ada;
  ada.bag.set('me', ada);

  const shared = { gold: 3 };
  const loop: Record<string, unknown> = { name: 'loop' };
  loop.self = loop;
  const sparse = [1];
  sparse[3] = 4;
  const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
  const nullProto = Object.assign(Object.create(null) as object, { a: 1 });

  const start = { party: { ada, bo }, shared, day: 1 };
  const room = {
    ...start,
    day: 2,
    values: {
      map: new Map<unknown, unknown>([
        ['b', 1],
        [{ k: 1 }, new Set([3, 1, 2])],
      ]),
      when: new Date(Date.UTC(2026, 9, 6, 12)),
      never: new Date(NaN),
      re: /a+(?<n>b)/giu,
      big: -123456789012345678901234567890n,
      nothing: undefined,
      numbers: [NaN, Infinity, -Infinity, -0, 0.1],
      sparse,
      bytes: new Uint8Array(buffer, 1, 2),
      view: new DataView(buffer),
      floats: new Float64Array([1.5, -2]),
      url: new URL('https://example.org/a?b=1#c'),
      params: new URLSearchParams('a=1&a=2'),
      // As `new TypeError(msg, { cause })` makes it (not in this TS lib)
      error: Object.defineProperty(new TypeError('bad'), 'cause', {
        value: new Error('root'),
        writable: true,
        configurable: true,
      }),
      custom: new GoldenError('custom'),
      boxed: [Object(1), Object('s'), Object(false)],
      symbol: Symbol.for('golden'),
      nullProto,
      escapedKeys: { '"': 1, '\n': 2, '\\': 3 },
      tagLike: { constructor: 1, __spindle_class__: 2, json: 3 },
      both: [shared, shared],
      loop,
    },
  };
  return {
    passage: 'Room',
    variables: room,
    history: [
      { passage: 'Start', variables: start, timestamp: 1000, prng: null },
      {
        passage: 'Room',
        variables: room,
        timestamp: 2000,
        prng: { seed: 'golden', pull: 3 },
      },
    ],
    historyIndex: 1,
    visitCounts: { Start: 1, Room: 1, __proto__x: 0 },
    renderCounts: { Start: 1, Room: 2 },
    prng: { seed: 'golden', pull: 4 },
  };
}

describe('stored save format (golden file)', () => {
  beforeAll(() => {
    clearRegistry();
    registerClass('GoldenHero', GoldenHero);
    registerClass('GoldenError', GoldenError);
  });
  afterAll(() => clearRegistry());

  it(`writes format version ${SAVE_FORMAT_VERSION} exactly as pinned`, () => {
    const encoded = encodePayload(representativePayload());
    if (process.env.UPDATE_GOLDEN === '1') {
      writeFileSync(FIXTURE, `${JSON.stringify(encoded, null, 2)}\n`);
    }
    const golden = JSON.parse(readFileSync(FIXTURE, 'utf8')) as EncodedPayload;
    expect(encoded.formatVersion).toBe(golden.formatVersion);
    expect(encoded.data).toBe(golden.data);
  });

  it('reads the pinned text back as the same state', () => {
    const golden = JSON.parse(readFileSync(FIXTURE, 'utf8')) as EncodedPayload;
    const payload = decodePayload(golden);
    // Counts load as the store holds them, without a prototype (a passage
    // may be named like an Object.prototype member)
    const { visitCounts, renderCounts, ...rest } = payload;
    const {
      visitCounts: wantVisits,
      renderCounts: wantRenders,
      ...wantRest
    } = representativePayload();
    expect(Object.getPrototypeOf(visitCounts)).toBeNull();
    expect({ ...visitCounts }).toEqual(wantVisits);
    expect({ ...renderCounts }).toEqual(wantRenders);
    expect(deepEqualStrict(rest, wantRest)).toBe(true);

    // The parts deepEqualStrict compares by structure, checked directly
    const room = payload.variables as any;
    const ada = room.party.ada;
    expect(ada).toBeInstanceOf(GoldenHero);
    expect(ada.friend.friend).toBe(ada);
    expect(ada.bag.get('me')).toBe(ada);
    expect(room.values.both[0]).toBe(room.shared);
    expect(room.values.loop.self).toBe(room.values.loop);
    expect(room.values.custom).toBeInstanceOf(GoldenError);
    expect(room.values.custom.message).toBe('custom');
    expect(room.values.error).toBeInstanceOf(TypeError);
    expect(room.values.error.cause.message).toBe('root');
    expect(room.values.bytes.buffer).toBe(room.values.view.buffer);
    expect(room.values.symbol).toBe(Symbol.for('golden'));
    expect(Object.keys(room.values.escapedKeys)).toEqual(['"', '\n', '\\']);
    expect(1 in room.values.sparse).toBe(false);
    // The moments share what did not change between them
    expect(payload.history[1]!.variables).toBe(room);
    expect((payload.history[0]!.variables as any).party).toBe(room.party);
  });
});
