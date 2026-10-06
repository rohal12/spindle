import { expect } from 'vitest';

/**
 * Assert that work scales about linearly with its input.
 *
 * `small` and `large` run the same work on an input and on 8× that input. A
 * linear algorithm takes about 8× as long on the large one, a quadratic one
 * about 64×, so the large run must take less than `limit` (24) × the small
 * one. Each is timed `rounds` times, alternating between the two so that a
 * burst of machine load hits both alike, and the best time of each is
 * compared. `floorMs` keeps a too-fast small run from making the bound
 * meaninglessly tight.
 */
export function expectAboutLinear(
  small: () => void,
  large: () => void,
  { rounds = 7, floorMs = 0.5, limit = 24 } = {},
): void {
  let bestSmall = Infinity;
  let bestLarge = Infinity;
  for (let round = 0; round < rounds; round++) {
    let t0 = performance.now();
    small();
    bestSmall = Math.min(bestSmall, performance.now() - t0);
    t0 = performance.now();
    large();
    bestLarge = Math.min(bestLarge, performance.now() - t0);
  }
  expect(bestLarge).toBeLessThan(Math.max(bestSmall, floorMs) * limit);
}
