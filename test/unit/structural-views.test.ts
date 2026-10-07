import { describe, it, expect } from 'vitest';
import { deepEqualStrict, shareEqual } from '../../src/structural';

describe('typed-array views (#283)', () => {
  it('are unequal when their offsets or backing buffers differ', () => {
    const plain = new Uint8Array([7]);
    const view = new Uint8Array(new Uint8Array([9, 7]).buffer, 1, 1);
    expect(deepEqualStrict(plain, view)).toBe(false);
    const shared = shareEqual(plain, view);
    expect(shared).not.toBe(plain);
    expect(shared.byteOffset).toBe(1);
    expect(Array.from(new Uint8Array(shared.buffer))).toEqual([9, 7]);
  });

  it('are equal when the view and its buffer match', () => {
    const a = new Uint8Array(new Uint8Array([9, 7]).buffer, 1, 1);
    const b = new Uint8Array(new Uint8Array([9, 7]).buffer, 1, 1);
    expect(deepEqualStrict(a, b)).toBe(true);
  });
});
