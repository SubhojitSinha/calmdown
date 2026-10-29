// Folder mode helpers: list the markdown files in a folder, fuzzy-match file paths for the
// quick switcher, and find matching lines for search across the folder. No DOM here.

export interface FolderFile {
  /** Path inside the folder, '/'-separated, e.g. "plans/Klarna.md". */
  path: string;
  handle: FileSystemFileHandle;
}

const MD_FILE = /\.(md|markdown|mdown|mkd)$/i;
/** Folders that hold tooling or build output, not documents. Hidden folders are skipped too. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', '__pycache__']);
export const MAX_FILES = 5000;
const MAX_DEPTH = 12;

/** Every markdown file under `dir`, sorted by path. Stops at MAX_FILES. */
export async function listMarkdownFiles(dir: FileSystemDirectoryHandle): Promise<FolderFile[]> {
  const out: FolderFile[] = [];
  const walk = async (d: FileSystemDirectoryHandle, prefix: string, depth: number): Promise<void> => {
    for await (const entry of d.values()) {
      if (out.length >= MAX_FILES) return;
      if (entry.name.startsWith('.')) continue;
      if (entry.kind === 'file') {
        if (MD_FILE.test(entry.name)) out.push({ path: prefix + entry.name, handle: entry as FileSystemFileHandle });
      } else if (depth < MAX_DEPTH && !SKIP_DIRS.has(entry.name)) {
        await walk(entry as FileSystemDirectoryHandle, `${prefix}${entry.name}/`, depth + 1);
      }
    }
  };
  await walk(dir, '', 0);
  const byPath = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  return out.sort((a, b) => byPath.compare(a.path, b.path));
}

/**
 * Fuzzy match for the quick switcher: every query character must appear in order in `text`.
 * Higher is better: consecutive runs, matches at word starts and in the file name score more,
 * shorter paths win ties. Null when it does not match.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return 0;
  const t = text.toLowerCase();
  const nameStart = t.lastIndexOf('/') + 1;
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return null;
    score += 1;
    if (at === prev + 1) score += 3; // run of consecutive characters
    if (at === 0 || /[\s/_.-]/.test(t[at - 1]!) || (text[at] !== t[at] && text[at - 1] === t[at - 1])) score += 2; // word start
    if (at >= nameStart) score += 1; // inside the file name
    prev = at;
    ti = at + 1;
  }
  return score - text.length / 100;
}

export interface LineMatch {
  /** 1-based line number. */
  line: number;
  text: string;
}

/** Lines of `text` containing `query` (case-insensitive), at most `max`, each trimmed to ~160 characters around the hit. */
export function findLines(text: string, query: string, max = 5): LineMatch[] {
  const q = query.toLowerCase();
  const out: LineMatch[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const l = lines[i]!;
    const at = l.toLowerCase().indexOf(q);
    if (at < 0) continue;
    const from = Math.max(0, at - 60);
    const snippet = (from > 0 ? '…' : '') + l.slice(from, at + q.length + 100).trim();
    out.push({ line: i + 1, text: snippet });
  }
  return out;
}
