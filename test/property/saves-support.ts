/**
 * The save system model shared by the sequential save model test and the
 * race test: the game (history moments, live variables), the playthroughs,
 * the slots and the saves made from the save dialog (not held by a slot).
 * Each save holds the playthrough it belongs to, the game state it captured
 * and its title.
 *
 * Modelled behaviour:
 * - A save belongs to the playthrough current when it is made (restart
 *   switches playthroughs at once).
 * - Loading a save moves the game to the save's playthrough (no change if it
 *   is the current one); a playthrough without a record (deleted since the
 *   save was read) is recorded again as "Imported". A refresh keeps the
 *   playthrough the game is in.
 * - A load restores the saved history and the variables recorded on
 *   entering the saved passage (docs/saves.md, "What a Load Restores").
 * - Overwriting a save generates its title again unless the player named it.
 * - An imported save keeps its playthrough; one whose playthrough is gone
 *   gets an "Imported" playthrough record.
 * - Deleting a playthrough deletes exactly its saves (and empties the slots
 *   holding them). Deleting the current one moves the running game to a new
 *   playthrough, so later saves are not left without one.
 * - Playthroughs are numbered in the order they start; numbers are never
 *   reused, and imported playthroughs take none.
 */
import { expect } from 'vitest';
import {
  useStoryStore,
  _resetRuntimePhase,
  resolvePlaythroughId,
} from '../../src/store';
import type { StoryAPI } from '../../src/story-api';
import { executeStoryInit } from '../../src/story-init';
import { resetEmitter } from '../../src/event-emitter';
import { resetTriggers } from '../../src/triggers';
import {
  deserializePayload,
  getSavesGrouped,
  exportSave,
} from '../../src/saves/save-manager';
import type { SavePayload } from '../../src/saves/types';
import {
  initVariables,
  makeStoryData,
  cloneVars,
  type PassageName,
} from './story-fixtures';
import { useBackend, type BackendName } from './save-backends';

export type Vars = Record<string, unknown>;

export interface Moment {
  passage: PassageName;
  vars: Vars;
}

export interface Game {
  moments: Moment[];
  index: number;
  live: Vars;
  visitCounts: Record<string, number>;
}

export interface SaveRec {
  /** Identifies the stored record (kept by overwrites and renames). */
  key: number;
  pt: string;
  game: Game;
  title: string;
  userTitle: boolean;
  /** Custom metadata, including the slot keys (`isAutosave`, `slot`). */
  custom: Record<string, unknown>;
}

export interface SavesModel {
  ifid: string;
  defaults: Vars;
  start: Vars;
  game: Game;
  current: string;
  pts: { id: string; label: string }[];
  ptCounter: number;
  slots: Map<string, SaveRec>;
  /** Saves made from the save dialog, by save ID. */
  loose: Map<string, SaveRec>;
  keyCounter: number;
}

export const SLOTS = ['', 'a', 'b'] as const;
export type Slot = (typeof SLOTS)[number];

/** Story API slot argument: the default slot is addressed by omitting it. */
export const slotArg = (slot: Slot) => (slot === '' ? undefined : slot);

export const store = () => useStoryStore.getState();
const Story = (): StoryAPI => window.Story;

/** The title generator the tests install; the model predicts its output. */
export function titleOf(passage: string, vars: Vars): string {
  return `${passage}|${JSON.stringify(vars.x) ?? '-'}`;
}

export function freshGame(start: Vars): Game {
  return {
    moments: [{ passage: 'Start', vars: cloneVars(start) }],
    index: 0,
    live: cloneVars(start),
    visitCounts: { Start: 1 },
  };
}

export function currentPassage(g: Game): PassageName {
  return g.moments[g.index]!.passage;
}

/** The slot keys `custom` holds for a save in `slot`. */
export function slotKeys(slot: Slot): Record<string, unknown> {
  return slot === '' ? { isAutosave: true } : { isAutosave: false, slot };
}

/**
 * The model's save of the current game, replacing `existing` if given.
 * Custom metadata passed is merged into the existing save's; a new slot save
 * gets the slot keys, a new dialog save (no `slot`) none.
 */
export function modelSave(
  m: SavesModel,
  existing?: SaveRec,
  init: { slot?: Slot; custom?: Record<string, unknown> } = {},
): SaveRec {
  const custom = existing
    ? { ...existing.custom, ...init.custom }
    : init.slot !== undefined
      ? { ...slotKeys(init.slot), ...init.custom }
      : {};
  return {
    custom,
    key: existing?.key ?? ++m.keyCounter,
    pt: m.current,
    game: cloneVars(m.game),
    title: existing?.userTitle
      ? existing.title
      : titleOf(currentPassage(m.game), m.game.live),
    userTitle: existing?.userTitle ?? false,
  };
}

/**
 * A load: the saved history, at the saved passage's entry snapshot, in the
 * save's playthrough.
 */
export function modelLoad(m: SavesModel, rec: SaveRec): void {
  m.game = cloneVars(rec.game);
  m.game.live = cloneVars(m.game.moments[m.game.index]!.vars);
  modelSwitchTo(m, rec.pt);
}

/** The game moves to the playthrough of a save it loads. */
export function modelSwitchTo(m: SavesModel, pt: string): void {
  m.current = pt;
  if (!m.pts.some((p) => p.id === pt)) {
    m.pts.push({ id: pt, label: 'Imported' });
  }
}

export function modelGoto(m: SavesModel, passage: PassageName): void {
  const g = m.game;
  g.moments = g.moments.slice(0, g.index + 1);
  g.moments.push({ passage, vars: cloneVars(g.live) });
  g.index = g.moments.length - 1;
  g.visitCounts[passage] = (g.visitCounts[passage] ?? 0) + 1;
}

/** Import `rec` (an exported copy) into `slot`. */
export function modelImport(m: SavesModel, rec: SaveRec, slot: Slot): void {
  // The slot keys follow the slot imported into
  const { slot: _from, ...custom } = cloneVars(rec.custom);
  m.slots.set(slot, {
    ...cloneVars(rec),
    key: ++m.keyCounter,
    custom: { ...custom, ...slotKeys(slot) },
  });
  if (!m.pts.some((p) => p.id === rec.pt)) {
    m.pts.push({ id: rec.pt, label: 'Imported' });
  }
}

export function modelDeletePlaythrough(m: SavesModel, id: string): void {
  m.pts = m.pts.filter((p) => p.id !== id);
  for (const [slot, rec] of m.slots) if (rec.pt === id) m.slots.delete(slot);
  for (const [sid, rec] of m.loose) if (rec.pt === id) m.loose.delete(sid);
}

/** The game moved to the playthrough the store now names. */
export function startPlaythrough(m: SavesModel): void {
  m.current = store().playthroughId;
  m.pts.push({ id: m.current, label: `Playthrough ${++m.ptCounter}` });
}

/**
 * Story.storage.clearGameData(): every save and playthrough of the story is
 * gone (numbering starts over) and the game restarts in a new playthrough,
 * `id`.
 */
export function modelClearGameData(m: SavesModel, id: string): void {
  m.slots.clear();
  m.loose.clear();
  m.pts = [];
  m.ptCounter = 0;
  m.current = id;
  m.pts.push({ id, label: `Playthrough ${++m.ptCounter}` });
  m.game = freshGame(m.start);
}

/** Remove the save whose record is `key`, wherever it is held. */
export function modelDeleteKey(m: SavesModel, key: number): void {
  for (const [slot, rec] of m.slots) if (rec.key === key) m.slots.delete(slot);
  for (const [sid, rec] of m.loose) if (rec.key === key) m.loose.delete(sid);
}

export function findKey(m: SavesModel, key: number): SaveRec | undefined {
  return [...m.slots.values(), ...m.loose.values()].find((r) => r.key === key);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let ifidCounter = 0;

/** Boot the story (as a page load does) for the model's IFID. */
export function boot(m: { ifid: string; defaults: Vars }): void {
  resetEmitter();
  resetTriggers();
  _resetRuntimePhase();
  store().init(makeStoryData(m.ifid), m.defaults);
  executeStoryInit();
}

/** A fresh backend and a booted story, with the model matching it. */
export async function newRun(
  backend: BackendName,
  x: number,
): Promise<SavesModel> {
  await useBackend(backend);
  sessionStorage.clear();
  useStoryStore.setState({ knownSaves: {}, playthroughId: '' });
  const defaults = { x };
  const start = initVariables(defaults);
  const model: SavesModel = {
    ifid: `saves-${backend}-${++ifidCounter}`,
    defaults,
    start,
    game: freshGame(start),
    current: '',
    pts: [],
    ptCounter: 0,
    slots: new Map(),
    loose: new Map(),
    keyCounter: 0,
  };
  boot(model);
  await resolvePlaythroughId();
  startPlaythrough(model);
  await assertMatches(model);
  return model;
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

export function expectGame(payload: SavePayload, g: Game): void {
  expect(payload.passage).toBe(currentPassage(g));
  expect(payload.historyIndex).toBe(g.index);
  expect(payload.history.map((h) => h.passage)).toEqual(
    g.moments.map((x) => x.passage),
  );
  payload.history.forEach((h, i) =>
    expect(h.variables).toStrictEqual(g.moments[i]!.vars),
  );
  expect(payload.variables).toStrictEqual(g.live);
  expect(payload.visitCounts).toEqual(g.visitCounts);
}

/** The real save ID held by each slot, from the public export. */
export async function slotIds(): Promise<Map<Slot, string>> {
  const ids = new Map<Slot, string>();
  for (const slot of SLOTS) {
    const data = await Story().exportSave(slotArg(slot));
    if (data) ids.set(slot, data.save.meta.id);
  }
  return ids;
}

/** The real save ID of each model record (by key). */
export async function recordIds(m: SavesModel): Promise<Map<number, string>> {
  const ids = new Map<number, string>();
  const bySlot = await slotIds();
  for (const [slot, rec] of m.slots)
    ids.set(rec.key, bySlot.get(slot as Slot)!);
  for (const [id, rec] of m.loose) ids.set(rec.key, id);
  return ids;
}

export async function assertMatches(m: SavesModel): Promise<void> {
  // Settle playthrough setups (restart's record, init's lookup)
  await resolvePlaythroughId();
  const s = store();
  const Story_ = Story();

  // The running game
  expect(s.playthroughId).toBe(m.current);
  expectGame(s.getSavePayload(), m.game);

  // Slots: presence, info, the playthrough and state each save holds
  for (const slot of SLOTS) {
    const rec = m.slots.get(slot);
    expect(Story_.hasSave(slotArg(slot))).toBe(rec !== undefined);
    const info = await Story_.getSaveInfo(slotArg(slot));
    const data = await Story_.exportSave(slotArg(slot));
    if (!rec) {
      expect(info).toBeNull();
      expect(data).toBeNull();
      continue;
    }
    expect(info).toEqual({
      slot,
      title: rec.title,
      passage: currentPassage(rec.game),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      custom: rec.custom,
    });
    expect(data!.save.meta.custom).toEqual(rec.custom);
    expect(data!.save.meta.playthroughId).toBe(rec.pt);
    expect(data!.save.meta.title).toBe(rec.title);
    expect(data!.save.meta.userTitle === true).toBe(rec.userTitle);
    expectGame(deserializePayload(data!.save.payload), rec.game);
  }
  expect((await Story_.listSaves()).map((i) => i.slot).sort()).toEqual(
    [...m.slots.keys()].sort(),
  );

  // Dialog saves
  for (const [id, rec] of m.loose) {
    const data = await exportSave(id);
    expect(data).toBeDefined();
    expect(data!.save.meta.playthroughId).toBe(rec.pt);
    expect(data!.save.meta.title).toBe(rec.title);
    expect(data!.save.meta.custom).toEqual(rec.custom);
    expectGame(deserializePayload(data!.save.payload), rec.game);
  }

  // Grouping: exactly the model's playthroughs, each with exactly its saves
  const ids = await slotIds();
  const expected = new Map<string, string[]>();
  for (const pt of m.pts) expected.set(pt.id, []);
  for (const [slot, rec] of m.slots) {
    expected.get(rec.pt)?.push(ids.get(slot as Slot)!);
  }
  for (const [id, rec] of m.loose) expected.get(rec.pt)?.push(id);
  const groups = await getSavesGrouped(m.ifid);
  expect(
    groups.map((g) => [g.playthrough.id, g.playthrough.label]).sort(),
  ).toEqual(m.pts.map((p) => [p.id, p.label]).sort());
  for (const g of groups) {
    expect(g.saves.map((r) => r.meta.id).sort()).toEqual(
      [...(expected.get(g.playthrough.id) ?? [])].sort(),
    );
  }

  const info = await Story_.storage.getInfo();
  expect(info.saveCount).toBe(m.slots.size + m.loose.size);
  expect(info.playthroughCount).toBe(m.pts.length);
}
