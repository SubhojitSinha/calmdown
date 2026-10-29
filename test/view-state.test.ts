import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadCollapsed,
  MAX_FILES,
  pruneStates,
  saveCollapsed,
  type CollapsedStates,
} from '../src/state/view-state';

beforeEach(() => localStorage.clear());

describe('view state', () => {
  it('round-trips a collapsed set per file', async () => {
    await saveCollapsed('file-1', new Set(['a', 'b']));
    await saveCollapsed('file-2', new Set(['x']));
    expect([...(await loadCollapsed('file-1'))].sort()).toEqual(['a', 'b']);
    expect([...(await loadCollapsed('file-2'))]).toEqual(['x']);
    expect((await loadCollapsed('unknown')).size).toBe(0);
  });

  it('removes the entry when nothing is collapsed', async () => {
    await saveCollapsed('f', new Set(['a']));
    await saveCollapsed('f', new Set());
    expect((await loadCollapsed('f')).size).toBe(0);
    expect(JSON.parse(localStorage.getItem('collapsed')!)).toEqual({});
  });

  it('keeps only the newest files', () => {
    const all: CollapsedStates = {};
    for (let i = 0; i < MAX_FILES + 5; i++) all[`f${i}`] = { ids: ['a'], at: i };
    const kept = pruneStates(all);
    expect(Object.keys(kept)).toHaveLength(MAX_FILES);
    expect(kept['f0']).toBeUndefined();
    expect(kept[`f${MAX_FILES + 4}`]).toBeDefined();
  });
});
