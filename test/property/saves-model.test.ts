// @vitest-environment happy-dom
/**
 * Model-based test of saves, slots and playthroughs (Story API and the
 * {saves} dialog's operations), run against every storage backend. The model
 * and what it predicts are described in saves-support.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fc from 'fast-check';
import { useStoryStore, resolvePlaythroughId } from '../../src/store';
import { installStoryAPI, type StoryAPI } from '../../src/story-api';
import { clearRegistry } from '../../src/class-registry';
import {
  loadSession,
  deserializePayload,
  createSave,
  overwriteSave,
  renameSave,
  deleteSaveById,
  exportSave,
  populateKnownSaves,
  getSavesGrouped,
  loadQuickSave,
  loadSave,
} from '../../src/saves/save-manager';
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
  modelGoto,
  modelImport,
  modelDeletePlaythrough,
  modelClearGameData,
  startPlaythrough,
  slotIds,
  boot,
  newRun,
  assertMatches,
  type SavesModel,
  type SaveRec,
  type Slot,
} from './saves-support';

let Story: StoryAPI;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

type Cmd = fc.AsyncCommand<SavesModel, unknown>;

/** Saves a dialog command can act on: slot saves, then dialog saves. */
async function targets(
  m: SavesModel,
): Promise<{ id: string; slot?: Slot; rec: SaveRec }[]> {
  const ids = await slotIds();
  return [
    ...SLOTS.filter((s) => m.slots.has(s)).map((slot) => ({
      id: ids.get(slot)!,
      slot,
      rec: m.slots.get(slot)!,
    })),
    ...[...m.loose].map(([id, rec]) => ({ id, rec })),
  ];
}

async function pickTarget(m: SavesModel, k: number) {
  const all = await targets(m);
  return all.length === 0 ? undefined : all[k % all.length]!;
}

abstract class Base implements Cmd {
  check = () => true;
  abstract act(m: SavesModel): Promise<void>;
  async run(m: SavesModel): Promise<void> {
    await this.act(m);
    await assertMatches(m);
  }
}

class SetVar extends Base {
  constructor(readonly value: number) {
    super();
  }
  async act(m: SavesModel) {
    Story.set('x', this.value);
    m.game.live.x = this.value;
  }
  toString = () => `Set(x=${this.value})`;
}

class FeedPet extends Base {
  constructor(readonly n: number) {
    super();
  }
  async act(m: SavesModel) {
    Story.set('pet.hunger', this.n);
    (m.game.live.pet as { hunger: number }).hunger = this.n;
  }
  toString = () => `FeedPet(${this.n})`;
}

class Goto extends Base {
  constructor(readonly passage: PassageName) {
    super();
  }
  async act(m: SavesModel) {
    Story.goto(this.passage);
    modelGoto(m, this.passage);
  }
  toString = () => `Goto(${this.passage})`;
}

class Back extends Base {
  async act(m: SavesModel) {
    Story.back();
    if (m.game.index > 0) {
      m.game.index--;
      m.game.live = cloneVars(m.game.moments[m.game.index]!.vars);
    }
  }
  toString = () => 'Back';
}

class Save extends Base {
  constructor(
    readonly slot: Slot,
    readonly custom?: Record<string, unknown>,
  ) {
    super();
  }
  async act(m: SavesModel) {
    await Story.save(slotArg(this.slot), cloneVars(this.custom));
    m.slots.set(
      this.slot,
      modelSave(m, m.slots.get(this.slot), {
        slot: this.slot,
        custom: this.custom,
      }),
    );
  }
  toString = () =>
    `Save(${JSON.stringify(this.slot)}, ${JSON.stringify(this.custom)})`;
}

class Load extends Base {
  constructor(readonly slot: Slot) {
    super();
  }
  async act(m: SavesModel) {
    await Story.load(slotArg(this.slot));
    const rec = m.slots.get(this.slot);
    if (rec) modelLoad(m, rec);
  }
  toString = () => `Load(${JSON.stringify(this.slot)})`;
}

class DeleteSlot extends Base {
  constructor(readonly slot: Slot) {
    super();
  }
  async act(m: SavesModel) {
    await Story.deleteSave(slotArg(this.slot));
    m.slots.delete(this.slot);
  }
  toString = () => `DeleteSlot(${JSON.stringify(this.slot)})`;
}

class ExportImport extends Base {
  constructor(
    readonly from: Slot,
    readonly to: Slot,
  ) {
    super();
  }
  async act(m: SavesModel) {
    const data = await Story.exportSave(slotArg(this.from));
    const rec = m.slots.get(this.from);
    expect(data !== null).toBe(rec !== undefined);
    if (!data || !rec) return;
    // As a file would carry it
    await Story.importSave(JSON.parse(JSON.stringify(data)), slotArg(this.to));
    modelImport(m, rec, this.to);
  }
  toString = () =>
    `ExportImport(${JSON.stringify(this.from)}→${JSON.stringify(this.to)})`;
}

class Restart extends Base {
  async act(m: SavesModel) {
    // Not awaited: the playthrough record is stored in the background
    Story.restart();
    startPlaythrough(m);
    m.game = freshGame(m.start);
  }
  toString = () => 'Restart';
}

class ClearGameData extends Base {
  async act(m: SavesModel) {
    await Story.storage.clearGameData();
    modelClearGameData(m, store().playthroughId);
  }
  toString = () => 'ClearGameData';
}

class DeletePlaythrough extends Base {
  constructor(readonly k: number) {
    super();
  }
  async act(m: SavesModel) {
    if (m.pts.length === 0) return;
    const { id } = m.pts[this.k % m.pts.length]!;
    await Story.storage.deletePlaythrough(id);
    modelDeletePlaythrough(m, id);
    if (id === m.current) startPlaythrough(m);
  }
  toString = () => `DeletePlaythrough(${this.k})`;
}

/** Page refresh: boot again (init looks up the playthrough), restore session. */
class Refresh extends Base {
  async act(m: SavesModel) {
    const session = loadSession(m.ifid);
    boot(m);
    if (session) {
      store().loadFromPayload(session);
      m.game.live = cloneVars(m.game.moments[m.game.index]!.vars);
    } else {
      m.game = freshGame(m.start);
    }
  }
  toString = () => 'Refresh';
}

/** {saves} dialog: Save (a new save, not in a slot). */
class DialogSave extends Base {
  async act(m: SavesModel) {
    const pt = resolvePlaythroughId();
    const record = await createSave(m.ifid, await pt, store().getSavePayload());
    m.loose.set(record.meta.id, modelSave(m));
  }
  toString = () => 'DialogSave';
}

/** {saves} dialog: Save Here. */
class DialogOverwrite extends Base {
  constructor(readonly k: number) {
    super();
  }
  async act(m: SavesModel) {
    const t = await pickTarget(m, this.k);
    if (!t) return;
    const pt = (await resolvePlaythroughId()) || undefined;
    await overwriteSave(t.id, store().getSavePayload(), undefined, pt);
    const rec = modelSave(m, t.rec);
    if (t.slot !== undefined) m.slots.set(t.slot, rec);
    else m.loose.set(t.id, rec);
  }
  toString = () => `DialogOverwrite(${this.k})`;
}

/** {saves} dialog: Load. */
class DialogLoad extends Base {
  constructor(readonly k: number) {
    super();
  }
  async act(m: SavesModel) {
    const t = await pickTarget(m, this.k);
    if (!t) return;
    const data = await exportSave(t.id);
    store().loadFromPayload(
      deserializePayload(data!.save.payload),
      undefined,
      data!.save.meta.playthroughId,
    );
    modelLoad(m, t.rec);
  }
  toString = () => `DialogLoad(${this.k})`;
}

/** {saves} dialog: Rename. */
class Rename extends Base {
  constructor(
    readonly k: number,
    readonly title: string,
  ) {
    super();
  }
  async act(m: SavesModel) {
    const t = await pickTarget(m, this.k);
    if (!t) return;
    await renameSave(t.id, this.title);
    t.rec.title = this.title;
    t.rec.userTitle = true;
  }
  toString = () => `Rename(${this.k}, ${JSON.stringify(this.title)})`;
}

/**
 * Change everything the save system returns (as a custom save UI might):
 * none of it may be shared with the stored saves.
 */
class Tamper extends Base {
  async act(m: SavesModel) {
    const tamper = (value: unknown, depth = 0): void => {
      if (value === null || typeof value !== 'object' || depth > 6) return;
      if (Array.isArray(value)) {
        value.forEach((v) => tamper(v, depth + 1));
        value.push('tampered');
        return;
      }
      const obj = value as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'object') tamper(v, depth + 1);
        else if (typeof v === 'string') obj[k] = `${v}!`;
        else if (typeof v === 'number') obj[k] = v + 1;
      }
      obj.tampered = true;
    };
    for (const slot of SLOTS) {
      tamper(await Story.getSaveInfo(slotArg(slot)));
      tamper(await Story.exportSave(slotArg(slot)));
      tamper(await loadQuickSave(m.ifid, slotArg(slot)));
    }
    tamper(await Story.listSaves());
    tamper(await getSavesGrouped(m.ifid));
    for (const id of m.loose.keys()) {
      tamper(await exportSave(id));
      tamper(await loadSave(id));
    }
  }
  toString = () => 'Tamper';
}

/** {saves} dialog: Delete. */
class DialogDelete extends Base {
  constructor(readonly k: number) {
    super();
  }
  async act(m: SavesModel) {
    const t = await pickTarget(m, this.k);
    if (!t) return;
    await deleteSaveById(t.id);
    const known = await populateKnownSaves(m.ifid);
    useStoryStore.setState({ knownSaves: known });
    if (t.slot !== undefined) m.slots.delete(t.slot);
    else m.loose.delete(t.id);
  }
  toString = () => `DialogDelete(${this.k})`;
}

const slotArb = fc.constantFrom(...SLOTS);
const kArb = fc.nat({ max: 7 });

const commandsArb = fc.commands(
  [
    fc.integer({ min: 0, max: 9 }).map((v) => new SetVar(v)),
    fc.integer({ min: 0, max: 9 }).map((n) => new FeedPet(n)),
    fc.constantFrom(...PASSAGES).map((p) => new Goto(p)),
    fc.constant(new Back()),
    slotArb.map((s) => new Save(s)),
    fc
      .tuple(
        slotArb,
        fc.record(
          { day: fc.nat({ max: 9 }), tag: fc.constantFrom('x', 'y') },
          { requiredKeys: [] },
        ),
      )
      .map(([s, custom]) => new Save(s, custom)),
    slotArb.map((s) => new Load(s)),
    slotArb.map((s) => new DeleteSlot(s)),
    fc.tuple(slotArb, slotArb).map(([a, b]) => new ExportImport(a, b)),
    fc.constant(new Restart()),
    fc.constant(new ClearGameData()),
    kArb.map((k) => new DeletePlaythrough(k)),
    fc.constant(new Refresh()),
    fc.constant(new DialogSave()),
    kArb.map((k) => new DialogOverwrite(k)),
    kArb.map((k) => new DialogLoad(k)),
    fc
      .tuple(kArb, fc.string({ minLength: 1, maxLength: 4 }))
      .filter(([, t]) => t.trim() === t && t !== '')
      .map(([k, t]) => new Rename(k, t)),
    kArb.map((k) => new DialogDelete(k)),
    fc.constant(new Tamper()),
  ],
  { maxCommands: 25, size: '+1' },
);

describe.each(BACKENDS)('saves model (%s)', (backend: BackendName) => {
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
    'matches a model of slots, dialog saves and playthroughs',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 9 }),
          commandsArb,
          async (x, cmds) => {
            const model = await newRun(backend, x);
            await fc.asyncModelRun(() => ({ model, real: {} }), cmds);
          },
        ),
        // Each case replays up to 25 commands, each checking every save; at
        // most 100 cases in CI (see modelRuns)
        { ...fcOptions, numRuns: modelRuns(100) },
      );
    },
    MODEL_TIMEOUT,
  );
});
