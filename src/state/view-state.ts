import { kvGet, kvSet } from './store';

// Collapsed sections, remembered per file. A section is identified by its heading id
// (heading text plus occurrence number), never by line number: edits shift lines.

const KEY = 'collapsed';
export const MAX_FILES = 50;

interface Entry {
  ids: string[];
  at: number;
}
export type CollapsedStates = Record<string, Entry>;

/** Keeps only the newest `max` files so the store cannot grow without bound. */
export function pruneStates(all: CollapsedStates, max = MAX_FILES): CollapsedStates {
  const keep = Object.entries(all)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, max);
  return Object.fromEntries(keep);
}

export async function loadCollapsed(fileKey: string): Promise<Set<string>> {
  const all = (await kvGet<CollapsedStates>(KEY)) ?? {};
  return new Set(all[fileKey]?.ids ?? []);
}

export async function saveCollapsed(fileKey: string, ids: Set<string>): Promise<void> {
  const all = (await kvGet<CollapsedStates>(KEY)) ?? {};
  if (ids.size === 0) delete all[fileKey];
  else all[fileKey] = { ids: [...ids], at: Date.now() };
  await kvSet(KEY, pruneStates(all));
}
