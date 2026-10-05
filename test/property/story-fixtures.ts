/**
 * Shared story fixtures for the model-based property tests of history,
 * navigation and saves.
 */
import type { StoryData, Passage } from '../../src/parser';
import { registerClass } from '../../src/class-registry';
import { NUM_RUNS } from './config';

/**
 * Runs for a model-based property. Each run replays a whole command
 * sequence, so CI uses a smaller budget than the default (`cap`); an
 * explicit FC_NUM_RUNS (a deep local run) applies unchanged.
 */
export function modelRuns(cap: number): number {
  const explicit = typeof process !== 'undefined' && process.env.FC_NUM_RUNS;
  return explicit ? NUM_RUNS : Math.min(NUM_RUNS, cap);
}

/** Per-test timeout: generous in CI, unbounded in practice for deep runs. */
export const MODEL_TIMEOUT =
  typeof process !== 'undefined' && process.env.FC_NUM_RUNS
    ? 3_600_000
    : 30_000;

/** Passages a model may navigate to (Start is the start passage). */
export const PASSAGES = ['Start', 'A', 'B', 'C'] as const;
export type PassageName = (typeof PASSAGES)[number];

/**
 * A registered class with nested state, so the models cover class instances
 * in history snapshots, saves and session restores.
 */
export class Pet {
  hunger = 0;
  log: number[] = [];
  constructor(data?: { hunger?: number; log?: number[] }) {
    if (data) Object.assign(this, data);
  }
  feed(n: number): void {
    this.hunger += n;
    this.log.push(n);
  }
}

/** Register Pet and expose it to story code (StoryInit's `new Pet(...)`). */
export function installPet(): void {
  registerClass('Pet', Pet);
  (globalThis as Record<string, unknown>).Pet = Pet;
}

/**
 * StoryInit seeds the PRNG and sets variables of every kind the models
 * track: a primitive, a nested plain object and a registered class instance
 * (built from the StoryVariables default `$x`).
 */
export const STORY_INIT = [
  '{do}Story.prng.init("model"){/do}',
  '{set $init = 1}',
  '{set $nested = {a: {b: [1]}}}',
  '{do}$pet = new Pet({hunger: $x, log: []}){/do}',
].join('\n');

/** The variables StoryInit leaves behind, given the StoryVariables defaults. */
export function initVariables(
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...structuredClone(defaults),
    init: 1,
    nested: { a: { b: [1] } },
    pet: new Pet({ hunger: defaults.x as number, log: [] }),
  };
}

function makePassage(pid: number, name: string, content: string): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

export function makeStoryData(ifid: string): StoryData {
  const passages = [
    ...PASSAGES.map((name, i) => makePassage(i + 1, name, '')),
    makePassage(PASSAGES.length + 1, 'StoryInit', STORY_INIT),
  ];
  return {
    name: 'Property model',
    startNode: 1,
    ifid,
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
}

/** Deep copy for model state: keeps Pet instances (and their prototype). */
export function cloneVars<T>(value: T): T {
  if (value instanceof Pet) {
    return new Pet({ hunger: value.hunger, log: [...value.log] }) as T;
  }
  if (Array.isArray(value)) return value.map(cloneVars) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = cloneVars(v);
    return out as T;
  }
  return value;
}
