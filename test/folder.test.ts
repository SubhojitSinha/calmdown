import { describe, expect, it } from 'vitest';
import { findLines, fuzzyScore, listMarkdownFiles } from '../src/viewer/folder';

/** A stand-in folder: nested objects are folders, strings are files. */
type Tree = { [name: string]: Tree | string };
function fakeDir(name: string, tree: Tree): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    async *values() {
      for (const [n, v] of Object.entries(tree)) {
        yield typeof v === 'string' ? ({ kind: 'file', name: n } as FileSystemFileHandle) : fakeDir(n, v);
      }
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe('listMarkdownFiles', () => {
  it('finds markdown files in subfolders, sorted, skipping tooling and hidden folders', async () => {
    const dir = fakeDir('docs', {
      'README.md': '',
      'notes.txt': '',
      plans: { 'Klarna-Vrio-Plan.md': '', 'b.markdown': '', deep: { 'x.md': '' } },
      node_modules: { 'pkg.md': '' },
      '.git': { 'HEAD.md': '' },
      '.hidden.md': '',
    });
    const paths = (await listMarkdownFiles(dir)).map((f) => f.path);
    expect(paths).toEqual(['plans/b.markdown', 'plans/deep/x.md', 'plans/Klarna-Vrio-Plan.md', 'README.md']);
  });
});

describe('fuzzyScore', () => {
  it('matches characters in order and ranks the better match first', () => {
    expect(fuzzyScore('klvrio', 'plans/Klarna-Vrio-Plan.md')).not.toBeNull();
    expect(fuzzyScore('zzz', 'plans/Klarna-Vrio-Plan.md')).toBeNull();
    const files = ['archive/old/notes-klarna.md', 'plans/Klarna-Vrio-Plan.md', 'README.md'];
    const best = files
      .map((f) => ({ f, s: fuzzyScore('kvplan', f) }))
      .filter((x) => x.s !== null)
      .sort((a, b) => b.s! - a.s!)[0]!.f;
    expect(best).toBe('plans/Klarna-Vrio-Plan.md');
    expect(fuzzyScore('', 'anything')).toBe(0);
  });
});

describe('findLines', () => {
  it('returns matching lines with 1-based numbers, case-insensitive, up to a limit', () => {
    const text = 'Intro\nKlarna is Stripe-brokered\nnothing\nklarna again\nKLARNA thrice';
    expect(findLines(text, 'klarna', 2)).toEqual([
      { line: 2, text: 'Klarna is Stripe-brokered' },
      { line: 4, text: 'klarna again' },
    ]);
    expect(findLines(text, 'absent')).toEqual([]);
  });

  it('trims long lines around the hit', () => {
    const long = `${'a'.repeat(300)} needle ${'b'.repeat(300)}`;
    const [hit] = findLines(long, 'needle');
    expect(hit!.text.startsWith('…')).toBe(true);
    expect(hit!.text).toContain('needle');
    expect(hit!.text.length).toBeLessThan(200);
  });
});
