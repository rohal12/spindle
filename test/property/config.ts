/**
 * Shared settings for property-based tests.
 *
 * CI runs a modest number of cases per property to keep the suite fast. Set
 * FC_NUM_RUNS (e.g. `FC_NUM_RUNS=100000 npx vitest run test/property`) for a
 * deep local run (it also lifts the per-test timeout, see vitest.config.ts),
 * and FC_SEED to replay a reported failure.
 */
const env = typeof process === 'undefined' ? {} : process.env;

export const NUM_RUNS = Number(env.FC_NUM_RUNS) || 300;

export const SEED = env.FC_SEED === undefined ? undefined : Number(env.FC_SEED);

/** Options to pass to fc.assert / test.prop. */
export const fcOptions = {
  numRuns: NUM_RUNS,
  ...(SEED === undefined ? {} : { seed: SEED }),
};
