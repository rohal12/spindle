/**
 * Seedable PRNG for Spindle — Mulberry32 algorithm.
 *
 * Provides deterministic random number generation that survives save/load
 * cycles via a pull-counter approach: recreate from seed, fast-forward N pulls.
 */

// ---------------------------------------------------------------------------
// Core algorithm
// ---------------------------------------------------------------------------

const MULBERRY_STEP = 0x6d2b79f5;

/** Mulberry32: fast, high-quality 32-bit PRNG. */
function mulberry32(seed: number): () => number {
  let t = seed | 0;
  return () => {
    t = (t + MULBERRY_STEP) | 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 0x100000000;
  };
}

/** FNV-1a hash — converts a string seed to a 32-bit integer. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let enabled = false;
let currentSeed = '';
let currentPull = 0;
let generator: (() => number) | null = null;
/** Incremented whenever the generator is replaced (init, restore, reset). */
let generation = 0;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PRNGSnapshot {
  readonly seed: string;
  readonly pull: number;
}

/**
 * Initialize the PRNG.
 * @param seed   Optional seed string. If omitted, a random seed is generated.
 * @param useEntropy  If true (default), mix `Date.now()` and `Math.random()`
 *                    into the seed for uniqueness across playthroughs.
 *                    Set to false for fully deterministic sequences.
 */
export function initPRNG(seed?: string, useEntropy = true): void {
  let resolvedSeed: string;
  if (seed === undefined) {
    resolvedSeed = String(Date.now()) + String(Math.random());
  } else if (useEntropy) {
    resolvedSeed = seed + '|' + Date.now() + '|' + Math.random();
  } else {
    resolvedSeed = seed;
  }

  currentSeed = resolvedSeed;
  currentPull = 0;
  generator = mulberry32(hashSeed(resolvedSeed));
  enabled = true;
  generation++;
}

/**
 * Restore PRNG state from a snapshot (used on save/load).
 * Recreates the generator from the seed and fast-forwards to the saved pull count.
 */
export function restorePRNG(seed: string, pull: number): void {
  generation++;
  moveTo(seed, pull);
}

/** Recreate the generator at `pull` pulls from `seed`. */
function moveTo(seed: string, pull: number): void {
  currentSeed = seed;
  // Fast-forward in constant time: each pull adds MULBERRY_STEP to the
  // 32-bit state, so `pull` pulls add pull × MULBERRY_STEP (mod 2^32). A
  // loop would hang on the large counts an imported save may hold.
  const steps = Math.imul(pull % 0x100000000, MULBERRY_STEP);
  generator = mulberry32((hashSeed(seed) + steps) | 0);
  enabled = true;
  currentPull = pull;
}

/** Disable the PRNG (used on restart before StoryInit re-enables it). */
export function resetPRNG(): void {
  generation++;
  enabled = false;
  currentSeed = '';
  currentPull = 0;
  generator = null;
}

/**
 * Run `fn` without its draws advancing the sequence: the draws it makes are
 * taken back afterwards (also when it throws), so the next draws return the
 * same values again. Save and load event handlers run like this, so that
 * saving or loading never shifts the story's random sequence (a load replays
 * the saved passage from its entry state, without the save's handlers). A
 * generator `fn` replaced (a restart or load it started) is kept.
 */
export function withoutDraws<T>(fn: () => T): T {
  const start = { generation, seed: currentSeed, pull: currentPull };
  try {
    return fn();
  } finally {
    if (
      enabled &&
      generation === start.generation &&
      currentPull !== start.pull
    ) {
      moveTo(start.seed, start.pull);
    }
  }
}

/** Returns the current PRNG state for snapshotting, or null if disabled. */
export function snapshotPRNG(): PRNGSnapshot | null {
  if (!enabled) return null;
  return { seed: currentSeed, pull: currentPull };
}

/** Returns a seeded random number [0, 1), or falls back to Math.random(). */
export function random(): number {
  if (!enabled || !generator) return Math.random();
  currentPull++;
  return generator();
}

/** Returns a random integer between min and max (inclusive). */
export function randomInt(min: number, max: number): number {
  if (min > max) [min, max] = [max, min];
  return Math.floor(random() * (max - min + 1)) + min;
}

export function isPRNGEnabled(): boolean {
  return enabled;
}

export function getPRNGSeed(): string {
  return currentSeed;
}

export function getPRNGPull(): number {
  return currentPull;
}
