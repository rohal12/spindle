import { describe, it, expect } from 'vitest';
import { isSaveExport, isSavePayload } from '../../src/saves/types';

function makeValidExport() {
  return {
    version: 1,
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
      payload: {
        passage: 'Start',
        variables: { hp: 100 },
        history: [{ passage: 'Start', variables: {}, timestamp: 1 }],
        historyIndex: 0,
      },
    },
  };
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

  it('returns false for wrong version', () => {
    const data = makeValidExport();
    (data as any).version = 2;
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

  it('returns false for non-string meta.id', () => {
    const data = makeValidExport();
    (data as any).save.meta.id = 123;
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for non-string meta.passage', () => {
    const data = makeValidExport();
    (data as any).save.meta.passage = 123;
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for non-string meta.ifid', () => {
    const data = makeValidExport();
    (data as any).save.meta.ifid = 42;
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for non-string meta.playthroughId', () => {
    const data = makeValidExport();
    (data as any).save.meta.playthroughId = 42;
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for non-string meta.createdAt', () => {
    const data = makeValidExport();
    (data as any).save.meta.createdAt = 42;
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for non-string meta.updatedAt', () => {
    const data = makeValidExport();
    (data as any).save.meta.updatedAt = 42;
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for non-string meta.title', () => {
    const data = makeValidExport();
    (data as any).save.meta.title = 42;
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for non-string payload.passage', () => {
    const data = makeValidExport();
    (data as any).save.payload.passage = 42;
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for non-array payload.history', () => {
    const data = makeValidExport();
    (data as any).save.payload.history = 'not-array';
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for non-number payload.historyIndex', () => {
    const data = makeValidExport();
    (data as any).save.payload.historyIndex = 'nope';
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for null payload.variables', () => {
    const data = makeValidExport();
    (data as any).save.payload.variables = null;
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for non-object payload.variables', () => {
    const data = makeValidExport();
    (data as any).save.payload.variables = 'string';
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for empty payload.history', () => {
    const data = makeValidExport();
    (data as any).save.payload.history = [];
    expect(isSaveExport(data)).toBe(false);
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
    const data = makeValidExport();
    (data as any).save.payload.history = [moment];
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false when any history moment is malformed', () => {
    const data = makeValidExport();
    (data as any).save.payload.history = [
      { passage: 'Room', variables: {}, timestamp: 1 },
      null,
      { passage: 'Start', variables: {}, timestamp: 2 },
    ];
    (data as any).save.payload.historyIndex = 2;
    expect(isSaveExport(data)).toBe(false);
  });

  it.each([
    ['negative', -1],
    ['past the end', 1],
    ['fractional', 0.5],
    ['NaN', NaN],
  ])('returns false for a %s historyIndex', (_, index) => {
    const data = makeValidExport();
    (data as any).save.payload.historyIndex = index;
    expect(isSaveExport(data)).toBe(false);
  });

  it("returns false when the current moment is not the payload's passage", () => {
    const data = makeValidExport();
    (data as any).save.payload.passage = 'Room';
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for a malformed payload.prng', () => {
    const data = makeValidExport();
    (data as any).save.payload.prng = 'seed';
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for non-object visit or render counts', () => {
    const visits = makeValidExport();
    (visits as any).save.payload.visitCounts = 3;
    expect(isSaveExport(visits)).toBe(false);
    const renders = makeValidExport();
    (renders as any).save.payload.renderCounts = null;
    expect(isSaveExport(renders)).toBe(false);
  });

  const malformedMap = {
    __spindle_class__: '__Map__',
    __spindle_data__: { entries: 42 },
  };

  it('returns false for a malformed encoded value in the live variables', () => {
    const data = makeValidExport();
    (data as any).save.payload.variables = { inventory: malformedMap };
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for a malformed encoded value in a history moment', () => {
    const data = makeValidExport();
    (data as any).save.payload.history = [
      { passage: 'Room', variables: { deep: [malformedMap] }, timestamp: 1 },
      { passage: 'Start', variables: {}, timestamp: 2 },
    ];
    (data as any).save.payload.historyIndex = 1;
    expect(isSaveExport(data)).toBe(false);
  });

  it('accepts well-formed encoded built-in values', () => {
    const data = makeValidExport();
    const variables = {
      seen: {
        __spindle_class__: '__Set__',
        __spindle_data__: { entries: ['Start'] },
      },
      at: {
        __spindle_class__: '__Date__',
        __spindle_data__: { iso: '2024-01-02T03:04:05.000Z' },
      },
    };
    (data as any).save.payload.variables = variables;
    (data as any).save.payload.history[0].variables = variables;
    expect(isSaveExport(data)).toBe(true);
  });

  it('returns false for a history with a hole', () => {
    // every() skips holes, which load as null moments
    const data = makeValidExport();
    const history = [{ passage: 'Start', variables: {}, timestamp: 1 }];
    history.length = 2;
    history.reverse();
    (data as any).save.payload.history = history;
    (data as any).save.payload.historyIndex = 1;
    expect(isSaveExport(data)).toBe(false);
  });

  it('returns false for a variable or property named __proto__', () => {
    const top = makeValidExport();
    (top as any).save.payload.variables = JSON.parse('{"__proto__": {"a": 1}}');
    expect(isSaveExport(top)).toBe(false);

    const nested = makeValidExport();
    (nested as any).save.payload.history[0].variables = JSON.parse(
      '{"x": {"y": {"__proto__": {"admin": true}}}}',
    );
    expect(isSaveExport(nested)).toBe(false);
  });

  it('accepts a multi-moment history with PRNG snapshots', () => {
    const data = makeValidExport();
    (data as any).save.payload = {
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
    };
    expect(isSaveExport(data)).toBe(true);
  });
});

describe('isSavePayload', () => {
  it('returns true for valid payload', () => {
    expect(
      isSavePayload({
        passage: 'Start',
        variables: { health: 100 },
        history: [{ passage: 'Start', variables: {}, timestamp: 1 }],
        historyIndex: 0,
      }),
    ).toBe(true);
  });

  it('returns false for null', () => {
    expect(isSavePayload(null)).toBe(false);
  });

  it('returns false for missing passage', () => {
    expect(isSavePayload({ variables: {}, history: [], historyIndex: 0 })).toBe(
      false,
    );
  });

  it('returns false for non-array history', () => {
    expect(
      isSavePayload({
        passage: 'X',
        variables: {},
        history: 'bad',
        historyIndex: 0,
      }),
    ).toBe(false);
  });

  it('returns false for non-number historyIndex', () => {
    expect(
      isSavePayload({
        passage: 'X',
        variables: {},
        history: [],
        historyIndex: 'bad',
      }),
    ).toBe(false);
  });

  it('returns false for null variables', () => {
    expect(
      isSavePayload({
        passage: 'X',
        variables: null,
        history: [],
        historyIndex: 0,
      }),
    ).toBe(false);
  });

  it('returns false for empty history array', () => {
    expect(
      isSavePayload({
        passage: 'X',
        variables: { hp: 100 },
        history: [],
        historyIndex: 0,
      }),
    ).toBe(false);
  });
});
