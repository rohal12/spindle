import { describe, it, expect } from 'vitest';
import { isSaveExport } from '../../src/saves/types';

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
});
