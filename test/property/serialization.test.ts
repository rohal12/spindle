import { beforeAll, afterAll, describe, expect, vi } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import {
  clearRegistry,
  deserialize,
  isDeserializable,
  serialize,
} from '../../src/class-registry';
import { deepClone } from '../../src/structural';
import { fcOptions } from './config';
import {
  reachableObjects,
  registerTestClasses,
  structEq,
  valueArb,
  viaJson,
} from './values';

beforeAll(() => {
  registerTestClasses();
  // Unregistered tags warn when they load as plain objects
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
  clearRegistry();
  vi.restoreAllMocks();
});

/** Save, store as JSON text, load. */
const roundTrip = (value: unknown): unknown =>
  deserialize(viaJson(serialize(value)));

const values = valueArb({ bigint: true, sparse: true });

describe('serialize / deserialize', () => {
  test.prop([values], fcOptions)(
    'restores every story value through JSON text',
    (value) => {
      expect(structEq(roundTrip(value), value)).toBe(true);
    },
  );

  test.prop([values], fcOptions)(
    'produces data the validator accepts',
    (value) => {
      expect(isDeserializable(viaJson(serialize(value)))).toBe(true);
    },
  );

  test.prop([valueArb({ protoKeys: true })], fcOptions)(
    'refuses a property named __proto__ instead of saving it',
    (value) => {
      const hasProtoKey = [...reachableObjects(value)].some((o) =>
        Object.prototype.hasOwnProperty.call(o, '__proto__'),
      );
      if (hasProtoKey) expect(() => serialize(value)).toThrow(/__proto__/);
      else expect(() => serialize(value)).not.toThrow();
    },
  );

  test.prop([values], fcOptions)('leaves its input unchanged', (value) => {
    const before = deepClone(value);
    serialize(value);
    expect(structEq(value, before)).toBe(true);
  });
});

// --- Untrusted data (imported saves) ---

const tagNames = fc.constantFrom(
  'Map',
  'Set',
  'Date',
  'RegExp',
  'BigInt',
  'Object',
  'null',
  'c:Point',
  'c:Counter',
  'c:Missing',
  'E:Error',
  'E:AggregateError',
  'E:Nope',
  'S',
  'K',
  'URL',
  'Uint8Array',
  'ArrayBuffer',
  'Nope',
  '__proto__',
);

/** A reference into flattened data: an index or a special value. */
const ref = fc.integer({ min: -7, max: 6 });

/**
 * JSON shaped like devalue's flattened form: entries that are plain values,
 * tagged arrays with right, wrong or missing fields, and objects and arrays
 * of references (in range, out of range or not integers).
 */
const tagLikeJson = fc.array(
  fc.oneof(
    fc.jsonValue({ maxDepth: 1 }),
    fc.tuple(tagNames, fc.oneof(ref, fc.string({ maxLength: 4 }))),
    fc.tuple(tagNames, ref, ref, ref),
    fc.array(fc.oneof(ref, fc.double()), { maxLength: 3 }),
    fc.dictionary(fc.string({ maxLength: 2 }), fc.oneof(ref, fc.double()), {
      maxKeys: 3,
    }),
  ),
  { minLength: 1, maxLength: 6 },
);

/**
 * Serialized values with one entry corrupted (replaced by junk, a field of a
 * tagged entry replaced, its tag renamed) or removed (a hole), as a script
 * passing objects to Story.importSave() could.
 */
const corruptedSerialized = fc
  .tuple(values, fc.nat(), tagNames, fc.jsonValue({ maxDepth: 2 }), fc.nat(3))
  .map(([value, pick, name, junk, mode]) => {
    const json = JSON.parse(serialize(value)) as unknown;
    if (!Array.isArray(json) || json.length === 0) return json;
    const i = pick % json.length;
    const entry = json[i] as unknown;
    if (mode === 0) json[i] = junk;
    else if (mode === 1 && Array.isArray(entry) && entry.length > 1) {
      entry[1 + (pick % (entry.length - 1))] = junk;
    } else if (mode === 2 && Array.isArray(entry)) entry[0] = name;
    else delete json[i];
    return json;
  });

/**
 * Anything the validator accepts loads, and what it loads saves and loads
 * again unchanged: an imported save cannot fail on load, and cannot break
 * the next save.
 */
function checkAcceptedLoads(data: unknown): void {
  // Saved data is JSON text
  const text = JSON.stringify(data);
  if (text === undefined || !isDeserializable(text)) return;
  const live = deserialize(text);
  const again = viaJson(serialize(live));
  expect(isDeserializable(again)).toBe(true);
  expect(structEq(deserialize(again), live)).toBe(true);
}

describe('isDeserializable on untrusted data', () => {
  test.prop([fc.jsonValue()], fcOptions)(
    'accepts only JSON that loads (arbitrary JSON)',
    checkAcceptedLoads,
  );

  test.prop([tagLikeJson], fcOptions)(
    'accepts only JSON that loads (tag-shaped JSON)',
    checkAcceptedLoads,
  );

  test.prop([corruptedSerialized], fcOptions)(
    'accepts only JSON that loads (corrupted saves)',
    checkAcceptedLoads,
  );
});
