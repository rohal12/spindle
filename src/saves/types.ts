import type { HistoryMoment } from '../store';

export interface SavePayload {
  passage: string;
  variables: Record<string, unknown>;
  history: HistoryMoment[];
  historyIndex: number;
  visitCounts?: Record<string, number>;
  renderCounts?: Record<string, number>;
}

export interface SaveMeta {
  id: string;
  ifid: string;
  playthroughId: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  passage: string;
  custom: Record<string, unknown>;
}

export interface SaveRecord {
  meta: SaveMeta;
  payload: SavePayload;
}

export interface PlaythroughRecord {
  id: string;
  ifid: string;
  createdAt: string;
  label: string;
}

export interface SaveExport {
  version: 1;
  ifid: string;
  exportedAt: string;
  save: SaveRecord;
}

export function isSaveExport(value: unknown): value is SaveExport {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (obj.version !== 1 || typeof obj.ifid !== 'string') return false;
  if (typeof obj.save !== 'object' || obj.save === null) return false;

  const save = obj.save as Record<string, unknown>;
  if (typeof save.meta !== 'object' || save.meta === null) return false;
  if (typeof save.payload !== 'object' || save.payload === null) return false;

  const meta = save.meta as Record<string, unknown>;
  if (typeof meta.id !== 'string' || typeof meta.passage !== 'string') return false;
  if (typeof meta.ifid !== 'string') return false;
  if (typeof meta.playthroughId !== 'string') return false;
  if (typeof meta.createdAt !== 'string') return false;
  if (typeof meta.updatedAt !== 'string') return false;
  if (typeof meta.title !== 'string') return false;

  const payload = save.payload as Record<string, unknown>;
  if (typeof payload.passage !== 'string') return false;
  if (!Array.isArray(payload.history)) return false;
  if (typeof payload.historyIndex !== 'number') return false;
  if (typeof payload.variables !== 'object' || payload.variables === null) return false;

  return true;
}
