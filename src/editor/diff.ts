// Small line diff for the conflict view: what is on disk versus what is in the editor.

export type DiffKind = 'same' | 'del' | 'add';
export interface DiffOp {
  kind: DiffKind;
  text: string;
}
export type DiffRow = DiffOp | { kind: 'gap'; count: number };

export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Longest-common-subsequence diff after trimming the shared head and tail. Beyond `maxCells`
 * the middle is reported as one replaced block (coarse) instead of risking a huge table.
 */
export function diffLines(
  a: string[],
  b: string[],
  maxCells = 4_000_000,
): { ops: DiffOp[]; coarse: boolean } {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head: DiffOp[] = a.slice(0, start).map((text) => ({ kind: 'same', text }));
  const tail: DiffOp[] = a.slice(endA).map((text) => ({ kind: 'same', text }));
  const am = a.slice(start, endA);
  const bm = b.slice(start, endB);

  if (am.length * bm.length > maxCells) {
    const ops = [
      ...head,
      ...am.map((text): DiffOp => ({ kind: 'del', text })),
      ...bm.map((text): DiffOp => ({ kind: 'add', text })),
      ...tail,
    ];
    return { ops, coarse: true };
  }

  const n = am.length;
  const m = bm.length;
  const w = m + 1;
  const table = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * w + j] =
        am[i] === bm[j]
          ? table[(i + 1) * w + j + 1]! + 1
          : Math.max(table[(i + 1) * w + j]!, table[i * w + j + 1]!);
    }
  }
  const mid: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (am[i] === bm[j]) {
      mid.push({ kind: 'same', text: am[i]! });
      i++;
      j++;
    } else if (table[(i + 1) * w + j]! >= table[i * w + j + 1]!) {
      mid.push({ kind: 'del', text: am[i++]! });
    } else {
      mid.push({ kind: 'add', text: bm[j++]! });
    }
  }
  while (i < n) mid.push({ kind: 'del', text: am[i++]! });
  while (j < m) mid.push({ kind: 'add', text: bm[j++]! });
  return { ops: [...head, ...mid, ...tail], coarse: false };
}

/** Collapses long unchanged runs into a gap marker, keeping `context` lines around changes. */
export function withContext(ops: DiffOp[], context = 2): DiffRow[] {
  const near = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op.kind === 'same') return;
    for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) near[k] = true;
  });
  const rows: DiffRow[] = [];
  let hidden = 0;
  ops.forEach((op, idx) => {
    if (op.kind === 'same' && !near[idx]) {
      hidden++;
      return;
    }
    if (hidden > 0) rows.push({ kind: 'gap', count: hidden });
    hidden = 0;
    rows.push(op);
  });
  if (hidden > 0) rows.push({ kind: 'gap', count: hidden });
  return rows;
}
