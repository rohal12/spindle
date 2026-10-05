import { beforeAll, afterAll, describe, expect, vi } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import {
  clearRegistry,
  deepClone,
  deserialize,
  isDeserializable,
  serialize,
} from '../../src/class-registry';
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

const tagNames = fc.oneof(
  fc.constantFrom(
    '__Date__',
    '__RegExp__',
    '__Map__',
    '__Set__',
    '__Object__',
    '__Number__',
    '__BigInt__',
    '__Undefined__',
    'Point',
    'Counter',
    'Missing',
    'constructor',
    '__proto__',
  ),
  fc.jsonValue({ maxDepth: 1 }),
);

/**
 * JSON that is mostly shaped like serialized data: tagged objects whose
 * names and data fields are right, wrong, missing or of the wrong type.
 */
const tagLikeJson = fc.letrec<{ value: unknown }>((tie) => {
  const sub = tie('value');
  const field = fc.oneof(
    sub,
    fc.constantFrom(
      '1970-01-01T00:00:00.000Z',
      'not a date',
      'a+',
      '(',
      'gi',
      'gg',
      'NaN',
      '-0',
      'Infinity',
      '12',
      '1.5',
      'x',
    ),
  );
  const data = fc.oneof(
    fc
      .record(
        {
          iso: field,
          source: field,
          flags: field,
          value: field,
          entries: fc.oneof(
            fc.array(fc.oneof(fc.tuple(sub, sub), sub), { maxLength: 3 }),
            sub,
          ),
          x: sub,
          ['__proto__']: sub,
        },
        { requiredKeys: [] },
      )
      .map((r) => JSON.parse(JSON.stringify(r)) as unknown),
    sub,
  );
  return {
    value: fc.oneof(
      { depthSize: 'small', maxDepth: 4 },
      fc.jsonValue({ maxDepth: 1 }),
      fc.array(sub, { maxLength: 3 }),
      fc.dictionary(fc.string({ maxLength: 3 }), sub, { maxKeys: 3 }),
      fc
        .record(
          { __spindle_class__: tagNames, __spindle_data__: data },
          { requiredKeys: [] },
        )
        .map((r) => JSON.parse(JSON.stringify(r)) as unknown),
    ),
  };
}).value;

/**
 * Serialized values with one tag corrupted (name, data or a data field
 * replaced, data removed), or with a hole punched into one array, as a
 * script passing objects to Story.importSave() could.
 */
const corruptedSerialized = fc
  .tuple(values, fc.nat(), tagNames, fc.jsonValue({ maxDepth: 2 }), fc.nat(4))
  .map(([value, pick, name, junk, mode]) => {
    const json = viaJson(serialize(value)) as unknown;
    const tags: Record<string, unknown>[] = [];
    const arrays: unknown[][] = [];
    const visit = (v: unknown): void => {
      if (typeof v !== 'object' || v === null) return;
      const o = v as Record<string, unknown>;
      if (Array.isArray(o)) arrays.push(o);
      else if ('__spindle_class__' in o) tags.push(o);
      for (const k of Object.keys(o)) visit(o[k]);
    };
    visit(json);
    if (mode === 4) {
      const arr = arrays.filter((a) => a.length > 0)[
        pick % Math.max(1, arrays.length)
      ];
      if (arr) delete arr[pick % arr.length];
    } else if (tags.length > 0) {
      const tag = tags[pick % tags.length]!;
      const data = tag.__spindle_data__ as Record<string, unknown> | undefined;
      if (mode === 0) tag.__spindle_class__ = name;
      else if (mode === 1) tag.__spindle_data__ = junk;
      else if (mode === 2 && typeof data === 'object' && data !== null) {
        const keys = Object.keys(data);
        if (keys.length > 0) data[keys[pick % keys.length]!] = junk;
      } else delete tag.__spindle_data__;
    }
    return json;
  });

/**
 * Anything the validator accepts loads, and what it loads saves and loads
 * again unchanged: an imported save cannot fail on load, and cannot break
 * the next save.
 */
function checkAcceptedLoads(data: unknown): void {
  if (!isDeserializable(data)) return;
  const live = deserialize(data);
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
