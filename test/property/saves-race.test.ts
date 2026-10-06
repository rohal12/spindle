// @vitest-environment happy-dom
/**
 * Race test of the save system: a batch of operations is issued in one go
 * (no awaiting in between, as a script or a quick succession of clicks
 * would), and fast-check's scheduler decides the order in which every
 * storage backend call starts. Whatever the interleaving, the result must
 * be that of running the operations one after another in call order (the
 * model in saves-support.ts): each save tagged with the playthrough current
 * at its call (never '' or a stale one), playthroughs numbered in the order
 * they started, no save lost, duplicated or resurrected.
 *
 * A load from a slot is the one operation whose effect on the game state
 * comes later: it switches playthroughs in call order (a save issued after
 * it belongs to the loaded playthrough) but applies the save once it has
 * been read, after the batch's synchronous operations; a restart, a boot or
 * a dialog load issued after it supersedes it.
 */
import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import fc from 'fast-check';
import { installStoryAPI, type StoryAPI } from '../../src/story-api';
import { clearRegistry } from '../../src/class-registry';
import { getBackend } from '../../src/saves/storage';
import {
  loadSession,
  renameSave,
  deleteSaveById,
  populateKnownSaves,
  exportSave,
  decodeSavePayload,
} from '../../src/saves/save-manager';
import { useStoryStore, resolvePlaythroughId } from '../../src/store';
import type { SaveExport, StorageBackend } from '../../src/saves/types';
import { fcOptions } from './config';
import {
  PASSAGES,
  installPet,
  cloneVars,
  modelRuns,
  MODEL_TIMEOUT,
  type PassageName,
} from './story-fixtures';
import { BACKENDS, type BackendName } from './save-backends';
import {
  SLOTS,
  slotArg,
  store,
  titleOf,
  freshGame,
  modelSave,
  modelLoad,
  modelSwitchTo,
  modelGoto,
  modelImport,
  modelDeletePlaythrough,
  modelClearGameData,
  modelDeleteKey,
  findKey,
  recordIds,
  boot,
  newRun,
  assertMatches,
  type SavesModel,
  type SaveRec,
  type Slot,
} from './saves-support';

let Story: StoryAPI;

/** What the batch's operations may refer to, taken before it is issued. */
interface Pre {
  ids: Map<number, string>;
  keys: number[];
  exports: Map<Slot, { data: SaveExport; rec: SaveRec }>;
  /** Every save, by key, as a save dialog opened before the batch lists it. */
  records: Map<number, { data: SaveExport; rec: SaveRec }>;
  pts: string[];
}

/**
 * Loads from slots issued but not applied yet, in call order: they apply
 * after the batch's synchronous operations, unless a restart, boot or dialog
 * load issued after them supersedes them.
 */
let pendingLoads: SaveRec[] = [];

/**
 * One operation: `issue` calls the API synchronously (returning its promise,
 * if any); `apply` performs it on the model, in call order, after the batch
 * has settled.
 */
interface Op {
  issue(m: SavesModel, pre: Pre): Promise<unknown> | void;
  apply(m: SavesModel, pre: Pre): void;
  toString(): string;
}

const ops = {
  set: (v: number): Op => ({
    issue: () => Story.set('x', v),
    apply: (m) => {
      m.game.live.x = v;
    },
    toString: () => `Set(x=${v})`,
  }),
  goto: (p: PassageName): Op => ({
    issue: () => Story.goto(p),
    apply: (m) => modelGoto(m, p),
    toString: () => `Goto(${p})`,
  }),
  save: (slot: Slot): Op => ({
    issue: () => Story.save(slotArg(slot)),
    apply: (m) => m.slots.set(slot, modelSave(m, m.slots.get(slot), { slot })),
    toString: () => `Save(${JSON.stringify(slot)})`,
  }),
  deleteSlot: (slot: Slot): Op => ({
    issue: () => Story.deleteSave(slotArg(slot)),
    apply: (m) => m.slots.delete(slot),
    toString: () => `DeleteSlot(${JSON.stringify(slot)})`,
  }),
  importInto: (from: Slot, to: Slot): Op => ({
    issue: (_m, pre) => {
      const exp = pre.exports.get(from);
      if (!exp) return undefined;
      return Story.importSave(structuredClone(exp.data), slotArg(to));
    },
    apply: (m, pre) => {
      const exp = pre.exports.get(from);
      if (exp) modelImport(m, exp.rec, to);
    },
    toString: () => `Import(${JSON.stringify(from)}→${JSON.stringify(to)})`,
  }),
  restart: (): Op => {
    let id = '';
    return {
      issue: () => {
        Story.restart();
        id = store().playthroughId;
      },
      apply: (m) => {
        m.current = id;
        m.pts.push({ id, label: `Playthrough ${++m.ptCounter}` });
        m.game = freshGame(m.start);
        pendingLoads = [];
      },
      toString: () => 'Restart',
    };
  },
  clearGameData: (): Op => {
    let next = '';
    return {
      issue: () => {
        const p = Story.storage.clearGameData();
        // The playthrough the game restarts in
        const id = resolvePlaythroughId().then((v) => (next = v));
        return Promise.all([p, id]);
      },
      apply: (m) => {
        modelClearGameData(m, next);
        pendingLoads = [];
      },
      toString: () => 'ClearGameData',
    };
  },
  deletePlaythrough: (k: number): Op => {
    let next = '';
    const target = (pre: Pre) => pre.pts[k % pre.pts.length]!;
    return {
      issue: (_m, pre) => {
        const p = Story.storage.deletePlaythrough(target(pre));
        // The game's playthrough from here on (while init is still looking
        // it up, the store has none yet)
        const id = resolvePlaythroughId().then((v) => (next = v));
        return Promise.all([p, id]);
      },
      apply: (m, pre) => {
        const id = target(pre);
        modelDeletePlaythrough(m, id);
        if (id === m.current) {
          m.current = next;
          m.pts.push({ id: next, label: `Playthrough ${++m.ptCounter}` });
        }
      },
      toString: () => `DeletePlaythrough(${k})`,
    };
  },
  rename: (k: number, title: string): Op => {
    const key = (pre: Pre) => pre.keys[k % pre.keys.length];
    return {
      issue: (_m, pre) => {
        const kk = key(pre);
        if (kk === undefined) return undefined;
        return renameSave(pre.ids.get(kk)!, title);
      },
      apply: (m, pre) => {
        const kk = key(pre);
        const rec = kk === undefined ? undefined : findKey(m, kk);
        if (rec) {
          rec.title = title;
          rec.userTitle = true;
        }
      },
      toString: () => `Rename(${k}, ${JSON.stringify(title)})`,
    };
  },
  dialogDelete: (k: number): Op => {
    const key = (pre: Pre) => pre.keys[k % pre.keys.length];
    return {
      issue: (m, pre) => {
        const kk = key(pre);
        if (kk === undefined) return;
        // As the dialog does: delete, then refresh the slot cache
        return deleteSaveById(pre.ids.get(kk)!).then(async () => {
          const known = await populateKnownSaves(m.ifid);
          useStoryStore.setState({ knownSaves: known });
        });
      },
      apply: (m, pre) => {
        const kk = key(pre);
        if (kk !== undefined) modelDeleteKey(m, kk);
      },
      toString: () => `DialogDelete(${k})`,
    };
  },
  refresh: (): Op => {
    let restored = false;
    return {
      issue: (m) => {
        const session = loadSession(m.ifid);
        boot(m);
        if (session) store().loadFromPayload(session);
        restored = session !== undefined;
      },
      apply: (m) => {
        // The session holds the game as it was at the refresh, without the
        // loads still pending, which booting supersedes. The game stays in
        // its playthrough (the stored current one).
        if (restored) {
          m.game.live = cloneVars(m.game.moments[m.game.index]!.vars);
        } else {
          m.game = freshGame(m.start);
        }
        pendingLoads = [];
      },
      toString: () => 'Refresh',
    };
  },
  load: (slot: Slot): Op => ({
    issue: () => Story.load(slotArg(slot)),
    apply: (m) => {
      // The slot's save at this point of the call order: the game moves to
      // its playthrough now, and to its state once it has been read
      const rec = m.slots.get(slot);
      if (!rec) return;
      modelSwitchTo(m, rec.pt);
      pendingLoads.push(cloneVars(rec));
    },
    toString: () => `Load(${JSON.stringify(slot)})`,
  }),
  dialogLoad: (k: number): Op => {
    const key = (pre: Pre) => pre.keys[k % pre.keys.length];
    return {
      // The dialog loads the save as it listed it, which may be gone (with
      // its playthrough) by now
      issue: (_m, pre) => {
        const kk = key(pre);
        if (kk === undefined) return;
        const { data } = pre.records.get(kk)!;
        store().loadFromPayload(
          decodeSavePayload(data.save.payload),
          undefined,
          data.save.meta.playthroughId,
        );
      },
      apply: (m, pre) => {
        const kk = key(pre);
        if (kk === undefined) return;
        modelLoad(m, pre.records.get(kk)!.rec);
        pendingLoads = [];
      },
      toString: () => `DialogLoad(${k})`,
    };
  },
};

/** Apply the loads from slots still pending (see pendingLoads). */
function settleLoads(m: SavesModel): void {
  for (const rec of pendingLoads) {
    m.game = cloneVars(rec.game);
    m.game.live = cloneVars(m.game.moments[m.game.index]!.vars);
  }
  pendingLoads = [];
}

const slotArb = fc.constantFrom(...SLOTS);
const kArb = fc.nat({ max: 7 });

/** Any operation. */
const opArb: fc.Arbitrary<() => Op> = fc.oneof(
  fc.integer({ min: 0, max: 9 }).map((v) => () => ops.set(v)),
  fc.constantFrom(...PASSAGES).map((p) => () => ops.goto(p)),
  slotArb.map((s) => () => ops.save(s)),
  slotArb.map((s) => () => ops.save(s)),
  slotArb.map((s) => () => ops.deleteSlot(s)),
  fc.tuple(slotArb, slotArb).map(
    ([a, b]) =>
      () =>
        ops.importInto(a, b),
  ),
  fc.constant(() => ops.restart()),
  fc.constant(() => ops.clearGameData()),
  kArb.map((k) => () => ops.deletePlaythrough(k)),
  fc.tuple(kArb, fc.constantFrom('Mine', 'Ours', 'Saved')).map(
    ([k, t]) =>
      () =>
        ops.rename(k, t),
  ),
  kArb.map((k) => () => ops.dialogDelete(k)),
  fc.constant(() => ops.refresh()),
  slotArb.map((s) => () => ops.load(s)),
  kArb.map((k) => () => ops.dialogLoad(k)),
);

/**
 * Loads mixed with the operations that change playthroughs or the saves a
 * load reads: saves, restarts, playthrough deletions, imports, other loads.
 */
const loadMixArb: fc.Arbitrary<() => Op> = fc.oneof(
  slotArb.map((s) => () => ops.load(s)),
  slotArb.map((s) => () => ops.load(s)),
  kArb.map((k) => () => ops.dialogLoad(k)),
  slotArb.map((s) => () => ops.save(s)),
  slotArb.map((s) => () => ops.save(s)),
  fc.constant(() => ops.restart()),
  kArb.map((k) => () => ops.deletePlaythrough(k)),
  fc.tuple(slotArb, slotArb).map(
    ([a, b]) =>
      () =>
        ops.importInto(a, b),
  ),
  fc.constantFrom(...PASSAGES).map((p) => () => ops.goto(p)),
);

/** Setup operations, run one at a time before the batch. */
const setupArb = fc.array(
  fc.oneof(
    fc.integer({ min: 0, max: 9 }).map((v) => () => ops.set(v)),
    fc.constantFrom(...PASSAGES).map((p) => () => ops.goto(p)),
    slotArb.map((s) => () => ops.save(s)),
    fc.constant(() => ops.restart()),
    slotArb.map((s) => () => ops.load(s)),
  ),
  { maxLength: 6 },
);

const BACKEND_METHODS = [
  'putSave',
  'getSave',
  'deleteSave',
  'getSavesByIfid',
  'deleteSavesByIfid',
  'deleteSavesByPlaythrough',
  'putPlaythrough',
  'getPlaythroughsByIfid',
  'deletePlaythroughsByIfid',
  'deletePlaythroughById',
  'getMeta',
  'setMeta',
  'deleteMeta',
  'deleteMetaByPrefix',
  'deleteMetaByIfid',
  'getAllMetaKeys',
] as const;

/**
 * Route every backend call through the scheduler: the call starts when the
 * scheduler releases it.
 */
async function scheduleBackend(s: fc.Scheduler): Promise<void> {
  const backend = (await getBackend()) as unknown as Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  > &
    StorageBackend;
  for (const name of BACKEND_METHODS) {
    const original = backend[name].bind(backend) as (
      ...args: unknown[]
    ) => Promise<unknown>;
    (backend as unknown as Record<string, unknown>)[name] = (
      ...args: unknown[]
    ) =>
      s
        .schedule(Promise.resolve(), `${name}(${String(args[0])})`)
        .then(() => original(...args));
  }
}

async function runOp(m: SavesModel, op: Op, pre: Pre): Promise<void> {
  await op.issue(m, pre);
  op.apply(m, pre);
  settleLoads(m);
}

async function snapshotPre(m: SavesModel): Promise<Pre> {
  const ids = await recordIds(m);
  const exports = new Map<Slot, { data: SaveExport; rec: SaveRec }>();
  for (const [slot, rec] of m.slots) {
    const data = await Story.exportSave(slotArg(slot as Slot));
    exports.set(slot as Slot, { data: data!, rec: cloneVars(rec) });
  }
  const records = new Map<number, { data: SaveExport; rec: SaveRec }>();
  for (const rec of [...m.slots.values(), ...m.loose.values()]) {
    const data = await exportSave(ids.get(rec.key)!);
    records.set(rec.key, { data: data!, rec: cloneVars(rec) });
  }
  return {
    ids,
    keys: [...ids.keys()],
    exports,
    records,
    pts: m.pts.map((p) => p.id),
  };
}

const EMPTY_PRE: Pre = {
  ids: new Map(),
  keys: [],
  exports: new Map(),
  records: new Map(),
  pts: [],
};

/**
 * Run the setup one operation at a time, then issue the batch at once with
 * every storage call scheduled, and compare the result with the model run
 * in call order.
 */
async function runBatch(
  s: fc.Scheduler,
  backend: BackendName,
  x: number,
  setup: (() => Op)[],
  batch: (() => Op)[],
): Promise<void> {
  const m = await newRun(backend, x);
  pendingLoads = [];
  for (const make of setup) await runOp(m, make(), EMPTY_PRE);
  await assertMatches(m);

  const pre = await snapshotPre(m);
  await scheduleBackend(s);

  const issued = batch.map((make) => make());
  const pending = issued.map((op) => Promise.resolve(op.issue(m, pre)));
  const results = await s.waitFor(Promise.allSettled(pending));
  // Background work: playthrough setups (restart, init)
  await s.waitFor(resolvePlaythroughId());

  for (const r of results) {
    if (r.status === 'rejected') throw r.reason;
  }
  for (const op of issued) op.apply(m, pre);
  settleLoads(m);
  // Still scheduled: whatever is left runs in a scheduled order
  await s.waitFor(assertMatches(m));
}

describe.each(BACKENDS)('save system races (%s)', (backend: BackendName) => {
  beforeAll(() => {
    installPet();
    installStoryAPI();
    Story = window.Story;
    Story.saves.setTitleGenerator((p) => titleOf(p.passage, p.variables));
  });

  afterAll(() => {
    clearRegistry();
    vi.unstubAllGlobals();
  });

  it(
    'settles as if the operations ran one by one in call order',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.scheduler(),
          fc.integer({ min: 0, max: 9 }),
          setupArb,
          fc.array(opArb, { minLength: 1, maxLength: 6 }),
          (s, x, setup, batch) => runBatch(s, backend, x, setup, batch),
        ),
        // Each case runs a setup and a batch, then checks every save; at most
        // 100 cases in CI (see modelRuns)
        { ...fcOptions, numRuns: modelRuns(100) },
      );
    },
    MODEL_TIMEOUT,
  );

  it(
    'switches to the loaded playthrough in call order, whatever the interleaving',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.scheduler(),
          fc.integer({ min: 0, max: 9 }),
          setupArb,
          fc.array(loadMixArb, { minLength: 2, maxLength: 7 }),
          (s, x, setup, batch) => runBatch(s, backend, x, setup, batch),
        ),
        { ...fcOptions, numRuns: modelRuns(100) },
      );
    },
    MODEL_TIMEOUT,
  );
});
