import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomUUID } from '../../src/utils/uuid';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomUUID', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('makes a v4 UUID', () => {
    expect(randomUUID()).toMatch(UUID_RE);
  });

  it('falls back where crypto.randomUUID is unavailable (plain HTTP)', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: globalThis.crypto.getRandomValues.bind(
        globalThis.crypto,
      ),
    });
    const a = randomUUID();
    expect(a).toMatch(UUID_RE);
    expect(randomUUID()).not.toBe(a);
  });
});
