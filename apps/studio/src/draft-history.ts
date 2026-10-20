import type { StudioResponse } from "../../../packages/studio-server/src/contracts.js";
import type { Selection } from "./ProjectExplorer";

export interface HistoryStep {
  label: string;
  selection: Selection | null;
  response: StudioResponse;
}

export interface DraftHistory {
  baseRevision: string;
  entries: HistoryStep[];
  index: number;
}

const LIMIT = 32;

export function openHistory(response: StudioResponse, selection: Selection | null): DraftHistory {
  return {
    baseRevision: response.bundle.revision,
    entries: [{ label: "Opened", selection, response }],
    index: 0,
  };
}

export function currentStep(history: DraftHistory): HistoryStep {
  return history.entries[history.index]!;
}

export function canUndo(history: DraftHistory): boolean {
  return history.index > 0;
}

export function canRedo(history: DraftHistory): boolean {
  return history.index < history.entries.length - 1;
}

export function pushHistory(history: DraftHistory, step: HistoryStep): DraftHistory {
  const entries = history.entries.slice(0, history.index + 1);
  entries.push(step);
  const capped = entries.length > LIMIT ? entries.slice(entries.length - LIMIT) : entries;
  return { ...history, entries: capped, index: capped.length - 1 };
}

export function undoHistory(history: DraftHistory): DraftHistory {
  if (!canUndo(history)) return history;
  return { ...history, index: history.index - 1 };
}

export function redoHistory(history: DraftHistory): DraftHistory {
  if (!canRedo(history)) return history;
  return { ...history, index: history.index + 1 };
}

export function unsavedHistory(history: DraftHistory): boolean {
  return currentStep(history).response.bundle.revision !== history.baseRevision;
}
