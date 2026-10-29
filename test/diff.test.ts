import { describe, expect, it } from 'vitest';
import { diffLines, splitLines, withContext } from '../src/editor/diff';

const kinds = (a: string, b: string) => diffLines(splitLines(a), splitLines(b)).ops.map((o) => o.kind + ':' + o.text);

describe('diffLines', () => {
  it('reports no changes for identical text, ignoring line-ending style', () => {
    expect(diffLines(splitLines('a\r\nb\r\n'), splitLines('a\nb\n')).ops.every((o) => o.kind === 'same')).toBe(true);
  });

  it('finds a replaced line', () => {
    expect(kinds('a\nb\nc', 'a\nX\nc')).toEqual(['same:a', 'del:b', 'add:X', 'same:c']);
  });

  it('finds an insertion and a deletion', () => {
    expect(kinds('a\nc', 'a\nb\nc')).toEqual(['same:a', 'add:b', 'same:c']);
    expect(kinds('a\nb\nc', 'a\nc')).toEqual(['same:a', 'del:b', 'same:c']);
  });

  it('handles empty sides', () => {
    expect(kinds('', 'a\nb')).toEqual(['add:a', 'add:b']);
    expect(kinds('a\nb', '')).toEqual(['del:a', 'del:b']);
    expect(diffLines([], []).ops).toEqual([]);
  });

  it('keeps unrelated edits apart (not one big replace)', () => {
    const r = kinds('1\n2\n3\n4\n5\n6', '1\nTWO\n3\n4\n5\nSIX');
    expect(r.filter((x) => x.startsWith('same'))).toEqual(['same:1', 'same:3', 'same:4', 'same:5']);
  });

  it('falls back to a coarse replace when the table would be too large', () => {
    const a = Array.from({ length: 50 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 50 }, (_, i) => `b${i}`);
    const r = diffLines(a, b, 100);
    expect(r.coarse).toBe(true);
    expect(r.ops.filter((o) => o.kind === 'del')).toHaveLength(50);
    expect(r.ops.filter((o) => o.kind === 'add')).toHaveLength(50);
  });

  it('reconstructs both sides from the ops', () => {
    const a = splitLines('x\ny\nz\nw\nq');
    const b = splitLines('x\nz\nNEW\nw\nq\nend');
    const { ops } = diffLines(a, b);
    expect(ops.filter((o) => o.kind !== 'add').map((o) => o.text)).toEqual(a);
    expect(ops.filter((o) => o.kind !== 'del').map((o) => o.text)).toEqual(b);
  });
});

describe('withContext', () => {
  it('hides long unchanged runs behind a gap', () => {
    const a = Array.from({ length: 20 }, (_, i) => `l${i}`);
    const b = a.slice();
    b[10] = 'CHANGED';
    const rows = withContext(diffLines(a, b).ops, 2);
    expect(rows[0]).toEqual({ kind: 'gap', count: 8 });
    expect(rows.at(-1)).toEqual({ kind: 'gap', count: 7 });
    expect(rows.filter((r) => r.kind === 'del' || r.kind === 'add')).toHaveLength(2);
  });
});
