// @vitest-environment happy-dom
import { afterAll, beforeAll, beforeEach, describe, expect, vi } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import { installStoryAPI, type StoryAPI } from '../../src/story-api';
import { resetEmitter } from '../../src/event-emitter';
import { getBackend, resetBackend } from '../../src/saves/storage';
import { clearRegistry } from '../../src/class-registry';
import { encodePayload, SAVE_FORMAT_VERSION } from '../../src/saves/format';
import { isSaveExport } from '../../src/saves/types';
import type { StoryData, Passage } from '../../src/parser';
import { fcOptions } from './config';
import {
  keyArb,
  propTimeout,
  registerTestClasses,
  structEq,
  valueArb,
  viaJson,
} from './values';

vi.setConfig({ testTimeout: propTimeout(10) });

const IFID = 'prop-save-export';

function makePassage(pid: number, name: string): Passage {
  return { pid, name, tags: [], metadata: {}, content: '' };
}

function makeStoryData(): StoryData {
  const passages = [makePassage(1, 'Start'), makePassage(2, 'Room')];
  return {
    name: 'Save export properties',
    startNode: 1,
    ifid: IFID,
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
}

let Story: StoryAPI;

beforeAll(() => {
  registerTestClasses();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  clearRegistry();
  vi.restoreAllMocks();
});

beforeEach(async () => {
  resetBackend();
  await getBackend();
  resetEmitter();
  _resetRuntimePhase();
  useStoryStore.setState({ knownSaves: {}, playthroughId: '' });
  useStoryStore.getState().init(makeStoryData(), { hp: 1 });
  installStoryAPI();
  Story = window.Story;
});

// --- Generated exports ---

const variablesArb = fc
  .array(
    fc.tuple(keyArb, valueArb({ bigint: true, sparse: true, maxDepth: 3 })),
    {
      maxLength: 4,
    },
  )
  .map((entries) => {
    const vars: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      Object.defineProperty(vars, k, {
        value: v,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return vars;
  });

const prngArb = fc.option(
  fc.record({
    seed: fc.string({ maxLength: 5 }),
    pull: fc.oneof(fc.nat(50), fc.maxSafeNat()),
  }),
  { nil: undefined },
);

const momentArb = fc.record({
  passage: fc.constantFrom('Start', 'Room'),
  variables: variablesArb,
  timestamp: fc.nat(),
  prng: prngArb,
});

/** A live payload and the export a save of it produces, as JSON. */
const exportArb = fc
  .tuple(
    fc.array(momentArb, { minLength: 1, maxLength: 3 }),
    fc.nat(),
    variablesArb,
    prngArb,
  )
  .map(([history, pick, variables, prng]) => {
    const historyIndex = pick % history.length;
    const payload = {
      passage: history[historyIndex]!.passage,
      variables,
      history,
      historyIndex,
      visitCounts: { Start: 1 },
      renderCounts: {},
      ...(prng ? { prng } : {}),
    };
    const exported = viaJson({
      formatVersion: SAVE_FORMAT_VERSION,
      ifid: IFID,
      exportedAt: '2026-01-01T00:00:00.000Z',
      save: {
        meta: {
          id: 'id',
          ifid: IFID,
          playthroughId: 'pt',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          title: 'Saved',
          passage: payload.passage,
          custom: {},
        },
        payload: encodePayload(payload),
      },
    }) as Record<string, unknown>;
    return { payload, exported };
  });

/** Import into a slot and load it; returns the store's load error. */
async function importAndLoad(data: unknown): Promise<string | null> {
  await Story.importSave(data as never, 'p');
  await Story.load('p');
  return useStoryStore.getState().loadError;
}

describe('save export', () => {
  test.prop([exportArb], {
    ...fcOptions,
    numRuns: Math.ceil(fcOptions.numRuns / 3),
  })(
    'is accepted on import and loads the saved moment',
    async ({ payload, exported }) => {
      expect(isSaveExport(exported)).toBe(true);
      expect(await importAndLoad(exported)).toBeNull();
      const state = useStoryStore.getState();
      expect(state.currentPassage).toBe(payload.passage);
      expect(state.historyIndex).toBe(payload.historyIndex);
      const entry = payload.history[payload.historyIndex]!.variables;
      // The store holds variables as a namespace without a prototype
      expect(Object.getPrototypeOf(state.variables)).toBe(null);
      expect(structEq({ ...state.variables }, entry)).toBe(true);
    },
  );

  /** One field anywhere in the export replaced by junk, or removed. */
  const corrupted = fc
    .tuple(exportArb, fc.nat(), fc.jsonValue({ maxDepth: 2 }), fc.boolean())
    .map(([generated, pick, junk, remove]) => {
      // A copy: fast-check reuses generated values while shrinking
      const exported = viaJson(generated.exported);
      const slots: [Record<string, unknown>, string][] = [];
      const visit = (v: unknown): void => {
        if (typeof v !== 'object' || v === null) return;
        for (const k of Object.keys(v)) {
          slots.push([v as Record<string, unknown>, k]);
          visit((v as Record<string, unknown>)[k]);
        }
      };
      visit(exported);
      const [holder, key] = slots[pick % slots.length]!;
      if (remove) delete holder[key];
      else holder[key] = junk;
      return exported;
    });

  test.prop([corrupted], {
    ...fcOptions,
    numRuns: Math.ceil(fcOptions.numRuns / 3),
  })('loads whenever the validator accepts it', async (exported) => {
    if (!isSaveExport(exported)) return;
    if (exported.ifid !== IFID) {
      // An export of another story (the validator does not know ours)
      await expect(Story.importSave(exported, 'p')).rejects.toThrow(
        /different story/,
      );
      return;
    }
    expect(await importAndLoad(exported)).toBeNull();
    // Filed under this story, whatever its metadata says
    const saves = await (await getBackend()).getSavesByIfid(IFID);
    expect(saves).toHaveLength(1);
  });
});
