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
