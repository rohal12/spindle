import { describe, it, expect, beforeEach } from 'vitest';
import {
  initPRNG,
  restorePRNG,
  resetPRNG,
  snapshotPRNG,
  random,
  randomInt,
  isPRNGEnabled,
  getPRNGSeed,
  getPRNGPull,
} from '../../src/prng';

beforeEach(() => {
  resetPRNG();
});

describe('prng', () => {
  describe('determinism', () => {
    it('same seed with useEntropy=false produces identical sequence', () => {
      initPRNG('test-seed', false);
      const seq1 = Array.from({ length: 10 }, () => random());

      initPRNG('test-seed', false);
      const seq2 = Array.from({ length: 10 }, () => random());

      expect(seq1).toEqual(seq2);
    });

    it('produces a known first value for a fixed seed', () => {
      initPRNG('test-seed', false);
      expect(random()).toBe(0.35841897572390735);
    });

    it('different seeds produce different sequences', () => {
      initPRNG('seed-a', false);
      const seq1 = Array.from({ length: 10 }, () => random());

      initPRNG('seed-b', false);
      const seq2 = Array.from({ length: 10 }, () => random());

      expect(seq1).not.toEqual(seq2);
    });
  });

  describe('pull counter', () => {
    it('starts at 0 and increments with each random() call', () => {
      initPRNG('counter-test', false);
      expect(getPRNGPull()).toBe(0);

      random();
      expect(getPRNGPull()).toBe(1);

      random();
      random();
      expect(getPRNGPull()).toBe(3);
    });
  });

  describe('restorePRNG()', () => {
    it('reproduces exact state from seed and pull count', () => {
      initPRNG('restore-test', false);

      // Generate 5 values
      for (let i = 0; i < 5; i++) random();

      // Snapshot and generate 5 more
      const snap = snapshotPRNG()!;
      const after = Array.from({ length: 5 }, () => random());

      // Restore and verify same 5 values
      restorePRNG(snap.seed, snap.pull);
      const restored = Array.from({ length: 5 }, () => random());

      expect(restored).toEqual(after);
    });
  });

  describe('resetPRNG()', () => {
    it('disables the PRNG', () => {
      initPRNG('reset-test', false);
      expect(isPRNGEnabled()).toBe(true);

      resetPRNG();
      expect(isPRNGEnabled()).toBe(false);
      expect(getPRNGSeed()).toBe('');
      expect(getPRNGPull()).toBe(0);
      expect(snapshotPRNG()).toBeNull();
    });
  });

  describe('fallback', () => {
    it('returns Math.random() when PRNG is disabled', () => {
      expect(isPRNGEnabled()).toBe(false);
      const val = random();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    });
  });

  describe('randomInt()', () => {
    it('returns integers within range (inclusive)', () => {
      initPRNG('int-test', false);
      for (let i = 0; i < 100; i++) {
        const val = randomInt(1, 6);
        expect(val).toBeGreaterThanOrEqual(1);
        expect(val).toBeLessThanOrEqual(6);
        expect(Number.isInteger(val)).toBe(true);
      }
    });
  });

  describe('distribution quality', () => {
    it('values are in [0, 1) range', () => {
      initPRNG('range-test', false);
      for (let i = 0; i < 1000; i++) {
        const val = random();
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
      }
    });

    it('has reasonable spread across buckets', () => {
      initPRNG('distribution-test', false);
      const buckets = [0, 0, 0, 0, 0];
      const n = 5000;
      for (let i = 0; i < n; i++) {
        const val = random();
        buckets[Math.floor(val * 5)]++;
      }
      // Each bucket should have roughly n/5 = 1000. Allow 30% deviation.
      for (const count of buckets) {
        expect(count).toBeGreaterThan((n / 5) * 0.7);
        expect(count).toBeLessThan((n / 5) * 1.3);
      }
    });
  });

  describe('snapshotPRNG()', () => {
    it('returns null when disabled', () => {
      expect(snapshotPRNG()).toBeNull();
    });

    it('returns seed and pull when enabled', () => {
      initPRNG('snap-test', false);
      random();
      random();
      const snap = snapshotPRNG();
      expect(snap).toEqual({ seed: 'snap-test', pull: 2 });
    });
  });

  describe('initPRNG() with entropy', () => {
    it('default useEntropy=true makes seed unique', () => {
      initPRNG('same');
      const seed1 = getPRNGSeed();

      initPRNG('same');
      const seed2 = getPRNGSeed();

      // Seeds should differ because of entropy mixing
      expect(seed1).not.toBe(seed2);
    });

    it('generates a seed when none provided', () => {
      initPRNG();
      expect(isPRNGEnabled()).toBe(true);
      expect(getPRNGSeed()).not.toBe('');
    });
  });
});
